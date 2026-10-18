import express, { type RequestHandler } from "express";
import { completeIdleReadOnlyResponse } from "./idle-admission.js";

export function staticUiFiles(root: string, options: Parameters<typeof express.static>[1] = {}): RequestHandler {
  const matched = new WeakSet<object>();
  const serve = express.static(root, {
    ...options,
    setHeaders(res, filePath, stat) {
      options?.setHeaders?.(res, filePath, stat);
      matched.add(res);
    },
  });
  return (req, res, next) => {
    const cleanup = () => {
      res.off("finish", complete);
      res.off("close", complete);
    };
    const complete = () => {
      if (!matched.has(res)) return;
      cleanup();
      completeIdleReadOnlyResponse(req);
    };
    const forward = (error?: unknown) => {
      cleanup();
      if (matched.has(res) && res.destroyed) {
        completeIdleReadOnlyResponse(req);
        return;
      }
      next(error);
    };
    res.once("finish", complete);
    res.once("close", complete);
    try {
      serve(req, res, forward);
    } catch (error) {
      forward(error);
    }
  };
}
