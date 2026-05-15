const baseUrl = "https://osu.ppy.sh/api"
console.log("i started doing shit");
Bun.serve({
  routes: {
    "/": {
      GET: () => Response.json({ message: "bello" }),
    },
    "/get_beatmaps": {
      GET: async (req) => {
        const url = new URL(req.url);
        const k = url.searchParams.get("k");
        const b = url.searchParams.get("b");

        if (!k || !b) {
          return Response.json({ error: "Missing required query parameters: k, b" }, { status: 400 });
        }

        const res = await fetch(`${baseUrl}/get_beatmaps?k=${k}&b=${b}`);

        return Response.json(await res.json(), { status: res.status });
      },
    },

    "/get_user": {
      GET: async (req) => {
        const k = new URL(req.url).searchParams.get("k");
        const u = new URL(req.url).searchParams.get("u");

        if (!k) {
          return Response.json({ error: "Missing required query parameter: k" }, { status: 400 });
        }

        const res = await fetch(`${baseUrl}/get_user?k=${k}&type=id&u=${u}`);
        return Response.json(await res.json(), { status: res.status });
      }
    },
    "/oauth/token": {
      POST: async (req) => {
        const form = new URLSearchParams(await req.text());
        const client_id = form.get("client_id") as string;
        const client_secret = form.get("client_secret") as string;
        const grant_type = form.get("grant_type") as string;
        const scope = form.get("scope") as string;

        if (!client_id || !client_secret || !grant_type || !scope) {
          return Response.json({ error: "Missing required fields: client_id, client_secret, grant_type, scope" }, { status: 400 });
        }

        const body = new URLSearchParams({ client_id, client_secret, grant_type, scope });
        const res = await fetch("https://osu.ppy.sh/oauth/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: body.toString(),
        });

        return Response.json(await res.json(), { status: res.status });
      },
    },
    "/v2/users/:id/:mode": {
      GET: async (req) => {
        const { id, mode } = req.params;
        const authorization = req.headers.get("Authorization");

        if (!authorization) {
          return Response.json({ error: "Missing Authorization header" }, { status: 401 });
        }

        const res = await fetch(`https://osu.ppy.sh/api/v2/users/${id}/${mode}`, {
          headers: { Authorization: authorization },
        });

        return Response.json(await res.json(), { status: res.status });
      },
    },
  },
  port: process.env.PORT ?? 3000,
});
