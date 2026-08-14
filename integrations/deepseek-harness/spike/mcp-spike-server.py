"""P0 spike:MCP v2 Streamable HTTP server,用于验证 DSH mcp-client 互通与真实模型工具往返。

基于官方 MCP Python SDK 2.0(精确锁版 mcp==2.0.0):
- MCPServer + streamable_http_app(stateless HTTP + JSON response);
- 正式版网关 core/agent/mcp_gateway.py 同此 API,挂载到 FastAPI /agent/mcp。
"""
from __future__ import annotations

import logging

from mcp.server.mcpserver import MCPServer

logging.basicConfig(level=logging.INFO)

mcp = MCPServer(
    name="crawshrimp-spike",
    version="0.1.0",
    instructions="P0 spike MCP server:验证 DSH MCP client ↔ Python MCP v2 Streamable HTTP 互通。",
)


@mcp.tool(description="把文本原样返回,用于验证工具往返。")
def echo(text: str) -> str:
    return f"echo: {text}"


@mcp.tool(description="返回 a+b,用于验证带参数的工具调用。")
def add(a: float, b: float) -> str:
    return f"sum: {a + b}"


app = mcp.streamable_http_app(
    streamable_http_path="/mcp",
    stateless_http=True,
    json_response=True,
    host="127.0.0.1",
)

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=18766, log_level="info", access_log=True)
