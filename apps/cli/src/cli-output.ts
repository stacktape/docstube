export type CliOutput = {
  error: (message: string) => void;
  info: (message: string) => void;
};

export type CliCommandResult = {
  exitCode: number;
};

export const defaultOutput: CliOutput = {
  info: (message) => console.info(message),
  error: (message) => console.error(message)
};
