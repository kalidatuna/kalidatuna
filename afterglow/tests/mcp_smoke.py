"""Start the MCP server over stdio and drive a small edit through it, like a real AI client would.

    python tests/mcp_smoke.py <video file>
"""
import asyncio
import base64
import json
import os
import sys
import tempfile

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


async def main(video):
    out = tempfile.mkdtemp(prefix="afterglow_smoke_")
    env = dict(os.environ, AFTERGLOW_HOME=out)
    params = StdioServerParameters(command=sys.executable, args=["-m", "afterglow.server"], env=env,
                                   cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    async with stdio_client(params) as (r, w):
        async with ClientSession(r, w) as s:
            await s.initialize()
            tools = (await s.list_tools()).tools
            print(f"{len(tools)} tools:", ", ".join(t.name for t in tools))

            async def call(tool_name, **args):
                res = await s.call_tool(tool_name, args)
                if getattr(res, "isError", False) or getattr(res, "is_error", False):
                    raise RuntimeError(f"{tool_name} failed: {res.content[0].text}")
                c = res.content[0]
                if c.type == "image":
                    path = os.path.join(out, f"{tool_name}.jpg")
                    open(path, "wb").write(base64.b64decode(c.data))
                    print(f"  {tool_name} → image {path}")
                    return path
                data = json.loads(c.text)
                print(f"  {tool_name} → {c.text[:160]}")
                return data

            print(await call("system_info"))
            await call("project_new", name="smoke", duration=4)
            m = await call("media_import", paths=[video])
            mid = next(iter(m))
            seq = await call("sequence_add", clips=[{"source": mid, "in": 0}, {"source": mid, "in": 2}], cut_times=[0, 2, 4])
            a, b = [l["id"] for l in seq["layers"]]
            await call("transition_add", from_layer=a, to_layer=b, type="whip_up", duration=0.4)
            adj = await call("layer_add", type="adjustment")
            await call("hit_apply", preset="impact", layer=adj["id"], times=[1.0, 3.0])
            await call("look_apply", look="cyberpunk_neon")
            await call("layer_add", type="text", props={"text": {"content": "SMOKE TEST", "size": 140,
                       "animate_in": {"preset": "pop", "unit": "char", "stagger": 0.03}}, "transform": {"position": [540, 1500]}})
            await call("effect_register_custom", name="scan_tint", glsl="""
                vec4 fx(vec2 uv){ vec4 s = T(uv); float k = 0.5 + 0.5 * sin(uv.y * 80.0 + u_time * 6.0);
                  return vec4(s.rgb * mix(vec3(1.0), u_tint.rgb, k * u_amount), s.a); }""",
                       params={"amount": {"default": 0.5, "min": 0, "max": 1}, "tint": {"default": "#30ffd0"}})
            await call("effect_add", layer=adj["id"], type="scan_tint", params={"amount": 0.3})
            res = await s.call_tool("batch", {"ops": [{"tool": "layer_update", "args": {"layer": a, "props": {"blend": "nope"}}}]})
            print("  batch error path →", res.content[0].text[:120])
            await call("preview_strip", start=1.8, end=2.2, count=0, scale=0.25)
            await call("preview_frame", time=1.0, scale=0.4)
            await call("media_frames", path=video, count=4)
            await call("render_start", output="smoke.mp4", scale=0.33, quality="draft")
            while True:
                st = await call("render_status", wait=30)
                if st["status"] != "rendering":
                    break
            assert st["status"] == "finished", st
            rep = await call("analyze_reference", path=st["output"])
            print("analysis of our own render:", rep["pacing"]["cuts"], rep["effects_detected"]["counts"])
    print("OK", out)


if __name__ == "__main__":
    asyncio.run(main(os.path.abspath(sys.argv[1])))
