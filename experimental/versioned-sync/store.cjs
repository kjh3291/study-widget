// Local protocol test server storage. Not loaded by the production widget.
const { DatabaseSync } = require('node:sqlite');
const { createHash } = require('node:crypto');
class Store {
  constructor(filename) {
    this.db = new DatabaseSync(filename);
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS changes(seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL, revision INTEGER NOT NULL, deleted INTEGER NOT NULL, value TEXT NOT NULL, UNIQUE(id,revision));
      CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY, revision INTEGER NOT NULL, deleted INTEGER NOT NULL, value TEXT NOT NULL, seq INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS receipts(op TEXT PRIMARY KEY, digest TEXT NOT NULL, result TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY, seq INTEGER NOT NULL);`);
  }
  decode(row) { return row && {...row, deleted: !!row.deleted, value: JSON.parse(row.value)}; }
  get(id) { return this.decode(this.db.prepare('SELECT * FROM records WHERE id=?').get(id)) || null; }
  head() { return this.db.prepare('SELECT COALESCE(MAX(seq),0) n FROM changes').get().n; }
  apply(op) {
    if (!op || typeof op.op !== 'string' || !op.op || typeof op.id !== 'string' || !op.id || !Number.isSafeInteger(op.base) || op.base < 0 || typeof op.deleted !== 'boolean' || !Object.hasOwn(op,'value')) throw new Error('Invalid operation');
    const digest=createHash('sha256').update(JSON.stringify(op)).digest('hex');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const receipt=this.db.prepare('SELECT * FROM receipts WHERE op=?').get(op.op);
      if(receipt) {
        if(receipt.digest!==digest) throw new Error('Operation ID reused with different content');
        this.db.exec('COMMIT'); return JSON.parse(receipt.result);
      }
      const current=this.get(op.id);
      if((current?.revision||0)!==op.base) {this.db.exec('COMMIT');return {ok:false,conflict:current};}
      const revision=op.base+1, value=JSON.stringify(op.value), deleted=Number(op.deleted);
      const seq=Number(this.db.prepare('INSERT INTO changes(id,revision,deleted,value) VALUES(?,?,?,?)').run(op.id,revision,deleted,value).lastInsertRowid);
      this.db.prepare('INSERT INTO records VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,deleted=excluded.deleted,value=excluded.value,seq=excluded.seq').run(op.id,revision,deleted,value,seq);
      const result={ok:true,record:this.get(op.id)};
      this.db.prepare('INSERT INTO receipts VALUES(?,?,?)').run(op.op,digest,JSON.stringify(result));
      this.db.exec('COMMIT');return result;
    } catch(e) {this.db.exec('ROLLBACK');throw e;}
  }
  pull(after=0) {return {head:this.head(),records:this.db.prepare('SELECT * FROM changes WHERE seq>? ORDER BY seq').all(after).map(x=>this.decode(x))};}
  history(id) {return this.db.prepare('SELECT * FROM changes WHERE id=? ORDER BY revision').all(id).map(x=>this.decode(x));}
  ack(device,seq) {
    if(!Number.isSafeInteger(seq)||seq<0||seq>this.head())throw new Error('Invalid acknowledgement');
    this.db.prepare('INSERT INTO devices VALUES(?,?) ON CONFLICT(id) DO UPDATE SET seq=MAX(seq,excluded.seq)').run(device,seq);
  }
  status() {return {head:this.head(),devices:this.db.prepare('SELECT * FROM devices').all()};}
  close(){this.db.close();}
}
module.exports={Store};
