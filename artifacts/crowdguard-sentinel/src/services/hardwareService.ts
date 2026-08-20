import { serviceConfig } from './config';
import { apiFetch } from './api';

export type HardwareCommand =
  | 'NORMAL'
  | 'REDIRECT_EXIT_A'
  | 'REDIRECT_EXIT_B'
  | 'EMERGENCY'
  | 'RESET'
  | 'STOP_ACTUATORS';

export async function sendHardwareCommand(command: HardwareCommand) {
  if (serviceConfig.useMockData) {
    return { accepted: true, command, simulated: true };
  }
  return apiFetch<{ accepted: boolean; command: HardwareCommand }>(
    '/hardware/commands',
    { method: 'POST', body: JSON.stringify({ command }) },
  );
}