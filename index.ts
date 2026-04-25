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

        if (!k) {
          return Response.json({ error: "Missing required query parameter: k" }, { status: 400 });
        }

        const res = await fetch(`${baseUrl}/get_user?k=${k}&type=id&u=2`);
        return Response.json(await res.json(), { status: res.status });
      }
    },
  },
  port: process.env.PORT ?? 3000,
});
