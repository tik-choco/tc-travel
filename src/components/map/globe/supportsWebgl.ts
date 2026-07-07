// Cheap, side-effect-free WebGL probe the orchestrator gates the globe on —
// when this returns false the SVG WorldMap ships instead. The throwaway
// context is explicitly released so the probe never counts against the
// browser's live-context budget.

export function supportsWebGL(): boolean {
  try {
    if (typeof document === "undefined" || typeof WebGLRenderingContext === "undefined") return false;
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl2") ?? canvas.getContext("webgl")) as
      | WebGLRenderingContext
      | WebGL2RenderingContext
      | null;
    if (!gl) return false;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}
