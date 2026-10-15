// 인터넷 공개(Funnel)에 대비한 시도 제한·잠금·보안 헤더.
// 서버 한 대·인원 수십 명 규모라 메모리에 둔다(재시작하면 초기화).

// Funnel(tailscaled)이 붙인 X-Forwarded-For의 마지막 값이 실제 접속 IP다.
// 클라이언트가 보낸 앞쪽 값은 위조될 수 있으므로 쓰지 않는다. TRUST_PROXY=true일 때만 사용.
const TRUST_PROXY = process.env.TRUST_PROXY === 'true';
export function clientIp(req) {
  if (TRUST_PROXY) {
    const xff = String(req.headers['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean);
    if (xff.length) return xff[xff.length - 1];
  }
  return req.ip;
}

// key별 시각 목록으로 창(window) 안의 횟수를 센다.
function createCounter(limit, windowMs) {
  const hits = new Map();
  const prune = (key, now) => {
    const list = (hits.get(key) || []).filter(t => now - t < windowMs);
    if (list.length) hits.set(key, list); else hits.delete(key);
    return list;
  };
  return {
    // 이미 한도를 넘었으면 남은 대기 초를, 아니면 0을 돌려준다.
    blocked(key, now = Date.now()) {
      const list = prune(key, now);
      return list.length >= limit ? Math.ceil((windowMs - (now - list[0])) / 1000) : 0;
    },
    hit(key, now = Date.now()) { prune(key, now); hits.set(key, [...(hits.get(key) || []), now]); },
    reset(key) { hits.delete(key); },
    sweep(now = Date.now()) { for (const key of [...hits.keys()]) prune(key, now); },
  };
}

const MIN = 60 * 1000;
const envInt = (name, fallback) => Number.parseInt(process.env[name], 10) || fallback;
export const limits = {
  loginIp: createCounter(envInt('LOGIN_IP_LIMIT', 30), 10 * MIN), // 한 IP에서 10분에 로그인 30번(자동 테스트가 도는 실험실은 .env로 높임)
  loginFail: createCounter(5, 15 * MIN),      // 한 학번 비밀번호 5번 틀리면 15분 잠금
  signupIp: createCounter(envInt('SIGNUP_IP_LIMIT', 5), 60 * MIN), // 한 IP에서 1시간에 가입 신청 5번
};
setInterval(() => Object.values(limits).forEach(c => c.sweep()), 5 * MIN).unref();

export function tooMany(reply, seconds, error = 'too_many') {
  reply.header('retry-after', String(seconds));
  return reply.code(429).send({ error, retryAfter: seconds });
}

export function securityHeaders(app) {
  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'no-referrer');
    if (!reply.getHeader('cache-control')) reply.header('cache-control', 'no-store');
    return payload;
  });
}
