// Devices the app knows. Until the WaveForms runtime is wired in, every one of them is simulated.
export type DeviceId = 'AD3' | 'DD' | 'ADP3450' | 'DEMO'

export interface DeviceInfo {
  id: DeviceId
  name: string
  /** Serial number, IP address or "Simulated". */
  serial: string
  link: 'USB' | 'LAN' | 'SIM'
}

export const devices: Record<DeviceId, DeviceInfo> = {
  AD3: { id: 'AD3', name: 'Analog Discovery 3', serial: 'SN:210415BB5D2F', link: 'USB' },
  DD: { id: 'DD', name: 'Digital Discovery', serial: 'SN:210321A8B7C1', link: 'USB' },
  ADP3450: { id: 'ADP3450', name: 'Analog Discovery Pro 3450', serial: '192.168.1.40', link: 'LAN' },
  DEMO: { id: 'DEMO', name: 'Demo Device', serial: 'Simulated', link: 'SIM' }
}
