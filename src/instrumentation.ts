import type { Instrumentation } from "next";

// The Node-only logging code lives in its own file so the Edge bundle never sees it.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") (await import("./instrumentation-node")).registerNode();
}

// Server errors from pages, route handlers and server actions land here as one structured record each.
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME === "nodejs") (await import("./instrumentation-node")).reportRequestError(err, request, context);
};
