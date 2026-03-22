/**
 * Lightweight health endpoint to warm edge isolates. No upstream APIs — safe to hit often.
 * Point external cron or GitHub Actions at GET /api/ping every few minutes.
 */
export default async () => {
    return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
        },
    });
};

export const config = {
    path: "/api/ping",
};
