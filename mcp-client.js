const path = require('path');

class McpManager {
  constructor(onStatus = () => {}) {
    this.onStatus = onStatus;
    this.connections = new Map();
    this.sdkPromise = null;
  }

  async sdk() {
    if (!this.sdkPromise) {
      this.sdkPromise = Promise.all([
        import('@modelcontextprotocol/sdk/client/index.js'),
        import('@modelcontextprotocol/sdk/client/stdio.js')
      ]).then(([client, stdio]) => ({ Client: client.Client, StdioClientTransport: stdio.StdioClientTransport }));
    }
    return this.sdkPromise;
  }

  normalizeServers(config = {}) {
    if (config.enabled === false || !Array.isArray(config.servers)) return [];
    return config.servers.filter(server => server && server.enabled !== false && server.name && server.command).map(server => ({
      name: String(server.name).trim().slice(0, 60),
      command: String(server.command).trim(),
      args: Array.isArray(server.args) ? server.args.map(String).slice(0, 30) : [],
      cwd: server.cwd ? path.resolve(String(server.cwd)) : undefined,
      env: server.env && typeof server.env === 'object'
        ? Object.fromEntries(Object.entries(server.env).map(([key, value]) => [String(key), String(value)]))
        : undefined
    }));
  }

  serverKey(server) {
    return JSON.stringify([server.command, server.args, server.cwd, server.env]);
  }

  async connection(server) {
    const existing = this.connections.get(server.name);
    const key = this.serverKey(server);
    if (existing?.key === key) return existing;
    if (existing) await this.closeConnection(existing);
    const { Client, StdioClientTransport } = await this.sdk();
    const client = new Client({ name: 'suisei-live2d-companion', version: '0.1.0' }, { capabilities: {} });
    const transport = new StdioClientTransport({
      command: server.command,
      args: server.args,
      cwd: server.cwd,
      env: server.env ? { ...process.env, ...server.env } : undefined,
      stderr: 'pipe'
    });
    await client.connect(transport);
    const connection = { key, client, transport, tools: null, toolsAt: 0 };
    this.connections.set(server.name, connection);
    return connection;
  }

  async withTimeout(promise, milliseconds, label) {
    let timer;
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out.`)), milliseconds); })
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async listTools(config = {}) {
    const servers = this.normalizeServers(config);
    const timeout = Math.max(1000, Math.min(30000, Number(config.timeoutMs) || 10000));
    const all = [];
    for (const server of servers) {
      try {
        const connection = await this.withTimeout(this.connection(server), timeout, `${server.name} connection`);
        if (!connection.tools || Date.now() - connection.toolsAt > 60000) {
          const result = await this.withTimeout(connection.client.listTools(), timeout, `${server.name} tool discovery`);
          connection.tools = Array.isArray(result.tools) ? result.tools : [];
          connection.toolsAt = Date.now();
        }
        for (const tool of connection.tools.slice(0, 50)) {
          all.push({ server: server.name, name: tool.name, description: tool.description || '', inputSchema: tool.inputSchema || { type: 'object' } });
        }
      } catch (error) {
        this.onStatus({ name: `mcp:${server.name}`, status: 'error', message: error.message });
      }
    }
    return all.slice(0, Math.max(1, Math.min(100, Number(config.maxTools) || 40)));
  }

  async call(config, request) {
    const server = this.normalizeServers(config).find(item => item.name === request?.server);
    if (!server) throw new Error(`MCP server "${request?.server || ''}" is not enabled.`);
    const tools = await this.listTools(config);
    if (!tools.some(tool => tool.server === server.name && tool.name === request.name)) throw new Error(`MCP tool "${request?.name || ''}" was not found.`);
    const timeout = Math.max(1000, Math.min(120000, Number(config.timeoutMs) || 10000));
    const connection = await this.connection(server);
    return this.withTimeout(connection.client.callTool({ name: request.name, arguments: request.arguments || {} }), timeout, `${server.name}/${request.name}`);
  }

  async closeConnection(connection) {
    try { await connection.client.close(); } catch {}
  }

  async close() {
    const connections = [...this.connections.values()];
    this.connections.clear();
    await Promise.allSettled(connections.map(connection => this.closeConnection(connection)));
  }
}

function formatMcpResult(request, result, maxCharacters = 14000) {
  const content = Array.isArray(result?.content) ? result.content : [];
  const rendered = content.map(item => {
    if (item?.type === 'text') return item.text;
    if (item?.type === 'resource') return item.resource?.text || `[Resource: ${item.resource?.uri || 'unknown'}]`;
    if (item?.type === 'image') return '[Image returned by MCP tool; image forwarding is not enabled.]';
    return JSON.stringify(item);
  }).filter(Boolean).join('\n');
  return `MCP TOOL RESULT\nServer: ${request.server}\nTool: ${request.name}\nStatus: ${result?.isError ? 'error' : 'success'}\n${rendered || '(no text result)'}`.slice(0, maxCharacters);
}

module.exports = { McpManager, formatMcpResult };
