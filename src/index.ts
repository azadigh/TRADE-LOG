import { DurableObject } from "cloudflare:workers";
import { Hono } from "hono";

export class App extends DurableObject {
  private app = new Hono()
    .get("/api/ping", (c) => c.json({ pong: true }))
    .get("/api/trades", async (c) => {
      this.initDb();
      const trades = this.ctx.storage.sql
        .exec(`SELECT * FROM trades ORDER BY timestamp DESC`)
        .toArray();
      return c.json(trades);
    })
    .post("/api/trades", async (c) => {
      this.initDb();
      const data = await c.req.json();
      
      const entry = parseFloat(data.entry);
      const exit = parseFloat(data.exit) || 0;
      const stopLoss = parseFloat(data.stop_loss);
      const takeProfit = parseFloat(data.take_profit) || 0;
      const amount = parseFloat(data.amount) || 1;
      
      let pnl = data.pnl;
      if (pnl === undefined && exit !== 0) {
        if (data.type === 'Long') {
          pnl = (exit - entry) * amount;
        } else {
          pnl = (entry - exit) * amount;
        }
      }

      let rr = data.rr;
      if (rr === undefined && stopLoss !== entry) {
        const risk = Math.abs(entry - stopLoss);
        const reward = exit !== 0 ? Math.abs(exit - entry) : Math.abs(takeProfit - entry);
        rr = risk !== 0 ? (reward / risk).toFixed(2) : 0;
      }

      this.ctx.storage.sql.exec(
        `INSERT INTO trades (
          pair, market, type, entry, exit, stop_loss, take_profit, 
          amount, pnl, rr, feeling, notes, timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        data.pair,
        data.market,
        data.type,
        entry,
        exit,
        stopLoss,
        takeProfit,
        amount,
        pnl || 0,
        rr || 0,
        data.feeling,
        data.notes,
        data.timestamp || Date.now()
      );

      return c.json({ success: true });
    })
    .delete("/api/trades/:id", async (c) => {
      this.initDb();
      const id = c.req.param("id");
      this.ctx.storage.sql.exec(`DELETE FROM trades WHERE id = ?`, id);
      return c.json({ success: true });
    });

  private initDb() {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pair TEXT NOT NULL,
        market TEXT NOT NULL,
        type TEXT NOT NULL,
        entry REAL NOT NULL,
        exit REAL,
        stop_loss REAL NOT NULL,
        take_profit REAL,
        amount REAL DEFAULT 1,
        pnl REAL DEFAULT 0,
        rr REAL DEFAULT 0,
        feeling TEXT,
        notes TEXT,
        timestamp INTEGER NOT NULL
      )
    `);
  }

  async fetch(request: Request) {
    const url = new URL(request.url);
    const match = url.pathname.match(/\/api\/.*/);
    if (match) {
      const newRequest = new Request(new URL(match[0], url.origin), request);
      return this.app.fetch(newRequest);
    }
    return this.app.fetch(request);
  }
}
