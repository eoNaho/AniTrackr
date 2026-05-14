type Level = "info" | "warn" | "error" | "debug";

function fmt(level: Level, module: string, msg: string) {
  const ts = new Date().toLocaleTimeString("pt-BR", { hour12: false });
  const label = `[${module.toUpperCase()}]`.padEnd(12);
  return `${ts} ${label} ${msg}`;
}

export const logger = {
  info: (module: string, msg: string) =>
    console.log(fmt("info", module, msg)),
  warn: (module: string, msg: string) =>
    console.warn(fmt("warn", module, msg)),
  error: (module: string, msg: string) =>
    console.error(fmt("error", module, msg)),
  debug: (module: string, msg: string) => {
    if (process.env.DEBUG) console.log(fmt("debug", module, msg));
  },
};
