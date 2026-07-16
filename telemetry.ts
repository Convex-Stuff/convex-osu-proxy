import { metrics, ValueType } from "@opentelemetry/api";
import { MeterProvider, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

const provider = new MeterProvider({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? "convex-osu-proxy",
  }),
  readers: [
    new PeriodicExportingMetricReader({
      // Endpoint comes from OTEL_EXPORTER_OTLP_ENDPOINT (http://alloy:4318 in compose),
      // falls back to http://localhost:4318 for local dev.
      exporter: new OTLPMetricExporter(),
      exportIntervalMillis: 15_000,
    }),
  ],
});

metrics.setGlobalMeterProvider(provider);

const meter = metrics.getMeter("convex-osu-proxy");

const requestCount = meter.createCounter("http.server.request.count", {
  description: "Total HTTP requests handled",
  valueType: ValueType.INT,
});

const requestDuration = meter.createHistogram("http.server.request.duration", {
  description: "HTTP request duration",
  unit: "s",
  advice: {
    explicitBucketBoundaries: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  },
});

type RouteHandler = (req: any) => Response | Promise<Response>;

export function instrumentRoutes<T extends Record<string, Record<string, RouteHandler>>>(routes: T): T {
  const instrumented: Record<string, Record<string, RouteHandler>> = {};

  for (const [route, methods] of Object.entries(routes)) {
    instrumented[route] = {};
    for (const [method, handler] of Object.entries(methods)) {
      instrumented[route][method] = async (req) => {
        const start = performance.now();
        let status = 500;
        try {
          const res = await handler(req);
          status = res.status;
          return res;
        } finally {
          const attributes = {
            "http.route": route,
            "http.request.method": method,
            "http.response.status_code": status,
          };
          requestCount.add(1, attributes);
          requestDuration.record((performance.now() - start) / 1000, attributes);
        }
      };
    }
  }

  return instrumented as T;
}

// Flush buffered metrics before the container stops.
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.once(signal, () => {
    provider.shutdown().finally(() => process.exit(0));
  });
}
