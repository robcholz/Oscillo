// The scripting API types: shown as types/oscillo.d.ts in Script, and used to type-check scripts.
export const OSCILLO_DTS = `declare module "oscillo" {
  export type MeasurementName = "PeakToPeak" | "Amplitude" | "Maximum" | "Minimum" | "Mean" | "RMS" | "ACRMS" | "Frequency" | "Period" | "RiseTime" | "FallTime" | "DutyCycle";
  export type WaveType = "Sine" | "Square" | "Triangle" | "RampUp" | "RampDown" | "Noise" | "Pulse" | "Trapezium" | "SinePower" | "DC";

  export interface Channel {
    /** Volts, one per sample. */
    readonly samples: Float64Array;
    /** Seconds from the trigger, one per sample. */
    readonly time: Float64Array;
    measure(name: MeasurementName): number;
  }
  export interface Capture {
    /** Samples per second. */
    readonly rate: number;
    /** Channel 1 or 2. */
    channel(n: 1 | 2): Channel;
  }
  export interface ScopeOptions {
    /** Samples per second (default 500 kS/s). */
    rate?: number;
    /** Samples per channel (default 16384). */
    samples?: number;
    /** Full-scale range in volts per channel (default 10 V). */
    range?: number;
    /** Volts offset per channel. */
    offset?: number;
    trigger?: { channel: 1 | 2; level: number; slope?: "Rise" | "Fall" | "Either"; position?: number; autoTimeout?: number };
  }
  export interface Scope {
    /** One acquisition of both channels. */
    single(options?: ScopeOptions): Promise<Capture>;
  }

  export interface WaveSettings {
    type: WaveType;
    frequency: number;
    amplitude: number;
    offset?: number;
    symmetry?: number;
    phase?: number;
  }
  export interface WavegenChannel {
    configure(settings: Partial<WaveSettings>): void;
    run(): Promise<void>;
    stop(): Promise<void>;
    frequency: number;
    amplitude: number;
    offset: number;
    readonly running: boolean;
  }
  export interface Wavegen {
    channel(n: 1 | 2): WavegenChannel;
  }

  export interface Rail {
    set(settings: { voltage?: number; enable?: boolean }): void;
    read(): { voltage: number; current: number };
  }
  export interface Supplies {
    positive: Rail;
    negative: Rail;
    /** Master enable. Setting a rail with enable: true turns it on too. */
    enable(on: boolean): void;
    /** USB voltage, current and device temperature. */
    monitor(): { usbVoltage: number; usbCurrent: number; temperature: number };
  }

  export interface LogicCapture {
    readonly rate: number;
    /** Level of a DIO pin at sample i. */
    level(pin: number, i: number): 0 | 1;
    readonly length: number;
  }
  export interface Frame {
    time: number;
    mosi: Bytes;
    miso: Bytes;
    text: string;
  }
  export interface Bytes {
    readonly values: number[];
    hex(): string;
  }
  export interface Interpreter {
    decode(capture: LogicCapture): Frame[];
  }
  export interface Logic {
    single(options?: { rate?: number; samples?: number }): Promise<LogicCapture>;
    interpreter(kind: "SPI", pins: { clock: number; select: number; mosi: number; miso: number }): Interpreter;
    interpreter(kind: "UART", pins: { rx: number; baud: number }): Interpreter;
  }

  export interface StaticIO {
    /** Drives the pins in mask to the levels in value; other pins become inputs. */
    write(mask: number, value: number): void;
    read(): number;
  }

  export interface DeviceInfo {
    name: string;
    serial: string;
  }

  export const scope: Scope;
  export const wavegen: Wavegen;
  export const supplies: Supplies;
  export const logic: Logic;
  export const io: StaticIO;
  export const device: DeviceInfo;
  /** Waits ms milliseconds. */
  export function wait(ms: number): Promise<void>;

  /** A text file in Documents/Oscillo. */
  export class File {
    constructor(name: string);
    readonly path: string;
    appendLine(line: string): void;
    write(text: string): void;
    read(): string;
  }
}

declare const console: { log(...values: unknown[]): void; error(...values: unknown[]): void; warn(...values: unknown[]): void };
`
