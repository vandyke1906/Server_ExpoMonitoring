import express from "express";
import cors from "cors";
import { createClient } from "@libsql/client";

// Load env vars if running locally (optional)
import dotenv from "dotenv";
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const db = createClient({
  url: process.env.TURSO_DB_URL,
  authToken: process.env.TURSO_DB_TOKEN,
});

app.post("/sync", async (req, res) => {
  console.info("Syncing...");
  try {
    const reports = req.body.reports;

    for (const report of reports) {
        console.error("Syncing:", { report });
        const values = [
            report.id,
            report.user_id,
            report.JSON.stringify(report.denr_personnels), // array → string
            report.other_agency_personnels ? JSON.stringify(report.other_agency_personnels) : null,
            report.activity_date_start,
            report.activity_date_end || null,
            report.location,
            report.persons_involved,
            report.complaint_description,
            report.action_taken,
            report.recommendation,
            report.photos ? JSON.stringify(report.photos) : null, // array → string or null
            1, // integer
            report..created_at
        ];
        await db.execute({
            sql: `
            INSERT INTO reports (
                id, user_id, denr_personnels, other_agency_personnels,
                activity_date_start, activity_date_end, location,
                persons_involved, complaint_description, action_taken,
                recommendation, photos, synced, created_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
            ON CONFLICT(id) DO NOTHING;
            `,
            args: values,
      });
    }

    res.status(200).json({ success: true, count: reports.length });
  } catch (error) {
    console.error("❌ Sync error:", error);
    res.status(500).json({ error: "Failed to sync reports." });
  }
});

app.get("/", (req, res) => {
  res.send("🟢 MANP Monitoring service API is live.");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
});
