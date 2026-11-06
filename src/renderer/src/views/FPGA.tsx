// FPGA Utility (board: FPGA). Pick the board and chain device, choose a bitstream, program with
// optional erase and verify, and keep a short history of runs.
import {
  Badge,
  Banner,
  Button,
  Fieldset,
  FormModal,
  Input,
  Progress,
  Select,
  Table,
  Toggle,
  type BadgeVariant,
} from "@robcholz/geist";
import { FolderOpen, Info, RefreshCw, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { OptionRow, PageBar, ScrollPage } from "../components/Page";
import { useStore } from "../store";

type Kind = "FPGA" | "Flash (PROM)";
const BOARDS: Record<string, { n: string; id: string; t: Kind }[]> = {
  "Basys 3": [
    { n: "XC7A35T", id: "0x0362D093", t: "FPGA" },
    { n: "S25FL032P", id: "0x00010215", t: "Flash (PROM)" },
  ],
  "Arty A7-35": [
    { n: "XC7A35T", id: "0x0362D093", t: "FPGA" },
    { n: "S25FL128S", id: "0x00010220", t: "Flash (PROM)" },
  ],
  "Nexys A7-100T": [
    { n: "XC7A100T", id: "0x13631093", t: "FPGA" },
    { n: "S25FL128S", id: "0x00010220", t: "Flash (PROM)" },
  ],
  "Cmod A7-35T": [
    { n: "XC7A35T", id: "0x0362D093", t: "FPGA" },
    { n: "N25Q032A", id: "0x0020BA16", t: "Flash (PROM)" },
  ],
};
const FILES = [
  "~/vivado/basys3_top.bit",
  "~/vivado/arty_blinky.bit",
  "~/vivado/prom_image.mcs",
  "~/vivado/nexys_video.bin",
];
type Result = "Verified" | "Programmed" | "Failed";
const RESULT: Record<Result, BadgeVariant> = {
  Verified: "green-subtle",
  Programmed: "gray-subtle",
  Failed: "red-subtle",
};
interface RunRow {
  w: string;
  f: string;
  d: string;
  t: string;
  r: Result;
}
const PAST: RunRow[] = [
  {
    w: "Today 09:42",
    f: "basys3_top.bit",
    d: "XC7A35T",
    t: "6.8 s",
    r: "Verified",
  },
  {
    w: "Today 09:31",
    f: "basys3_top.bit",
    d: "XC7A35T",
    t: "1.2 s",
    r: "Failed",
  },
  {
    w: "Yesterday 17:20",
    f: "prom_image.mcs",
    d: "S25FL128S",
    t: "41.5 s",
    r: "Verified",
  },
  {
    w: "Yesterday 16:05",
    f: "arty_blinky.bit",
    d: "XC7A35T",
    t: "5.9 s",
    r: "Programmed",
  },
];

const DEFAULTS = {
  board: "Basys 3",
  dev: "FPGA" as Kind,
  path: "",
  erase: true,
  verify: true,
  banner: true,
  runs: PAST,
};
type FpgaState = typeof DEFAULTS & {
  set: (p: Partial<typeof DEFAULTS>) => void;
};
const useFpga = create<FpgaState>()(
  persist((set) => ({ ...DEFAULTS, set: (p) => set(p) }), {
    name: "oscillo.fpga",
    partialize: ({ set: _s, ...r }) => r,
  }),
);

const W = "w-[220px]";

export function FPGA() {
  const s = useFpga();
  const toast = useStore((x) => x.toast);
  const [pct, setPct] = useState(0);
  const [phase, setPhase] = useState<"idle" | "busy" | "done">("idle");
  const [browse, setBrowse] = useState(false);
  const [scanned, setScanned] = useState(Date.now() - 2000);
  const timer = useRef<ReturnType<typeof setInterval>>(undefined);
  useEffect(() => () => clearInterval(timer.current), []);

  const devs = BOARDS[s.board] ?? BOARDS["Basys 3"];
  const target = devs.find((d) => d.t === s.dev) ?? devs[0];
  const flash = s.dev === "Flash (PROM)";
  const fname = s.path.split(/[\\/]/).pop() ?? "";
  const valid = /\.(bit|bin|mcs)$/i.test(fname);
  const busy = phase === "busy";
  const erase = flash && s.erase;
  const status = busy
    ? erase && pct < 15
      ? "Erasing…"
      : pct < 90 || !s.verify
        ? "Programming…"
        : "Verifying…"
    : phase === "done"
      ? s.verify
        ? "Programmed and verified"
        : "Programmed"
      : "Ready to program";

  const start = (): void => {
    if (!valid)
      return toast("No bitstream selected", {
        detail: "Choose a .bit, .bin or .mcs file, then program again.",
      });
    if (flash && /\.bit$/i.test(fname))
      return toast("Flash needs a .bin or .mcs file", {
        detail:
          "Write the configuration file from Vivado, or program the FPGA instead.",
      });
    if (!flash && /\.mcs$/i.test(fname))
      return toast("An .mcs file programs Flash", {
        detail: "Set Chain Device to Flash (PROM), or choose a .bit file.",
      });
    // Flash is much slower to write than the FPGA's configuration memory.
    const stepPct = flash ? 1 : 4;
    const t0 = Date.now();
    setPhase("busy");
    setPct(0);
    clearInterval(timer.current);
    let p = 0;
    timer.current = setInterval(() => {
      p = Math.min(100, p + stepPct);
      setPct(p);
      if (p < 100) return;
      clearInterval(timer.current);
      const r: Result = s.verify ? "Verified" : "Programmed";
      const when = new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
      s.set({
        runs: [
          {
            w: when,
            f: fname,
            d: target.n,
            t: ((Date.now() - t0) / 1000).toFixed(1) + " s",
            r,
          },
          ...useFpga.getState().runs,
        ].slice(0, 8),
      });
      setPhase("done");
      toast(`Programmed ${fname}`, {
        detail: `${target.n} on ${s.board}${s.verify ? ", verified" : ""}`,
      });
    }, 80);
  };

  return (
    <ScrollPage
      className="flex max-w-[1120px] flex-col gap-4"
      bar={
        <>
          <PageBar title="FPGA Utility">
            <Button
              size="small"
              prefix={<Upload size={16} />}
              loading={busy}
              disabled={busy}
              onClick={start}
            >
              {busy ? "Programming" : "Program Device"}
            </Button>
          </PageBar>
          {s.banner && (
            <Banner
              icon={<Info size={16} />}
              onClose={() => s.set({ banner: false })}
            >
              Programs FPGA, CPLD and PROM chips on Digilent boards over JTAG.
            </Banner>
          )}
        </>
      }
    >
      <Fieldset
        titleSize={16}
        title="Target"
        subtitle="The board and chain device to program, and every device found on the JTAG chain."
        footer={`${devs.length} devices · scanned ${Date.now() - scanned < 10e3 ? "just now" : new Date(scanned).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
        actions={
          <Button
            type="secondary"
            size="small"
            prefix={<RefreshCw size={16} />}
            disabled={busy}
            onClick={() => {
              setScanned(Date.now());
              toast(`Found ${devs.length} devices on the JTAG chain`);
            }}
          >
            Scan Chain
          </Button>
        }
      >
        <div className="mb-4">
          <OptionRow
            label="Board"
            description="The Digilent board the cable is plugged into."
          >
            <div className={W}>
              <Select
                size="small"
                aria-label="Board"
                value={s.board}
                options={Object.keys(BOARDS)}
                disabled={busy}
                onValueChange={(board) => (s.set({ board }), setPhase("idle"))}
              />
            </div>
          </OptionRow>
          <OptionRow
            label="Chain Device"
            description="The device on the chain to program."
          >
            <div className={W}>
              <Select
                size="small"
                aria-label="Chain Device"
                value={s.dev}
                options={["FPGA", "Flash (PROM)"]}
                disabled={busy}
                onValueChange={(dev) => (
                  s.set({ dev: dev as Kind }),
                  setPhase("idle")
                )}
              />
            </div>
          </OptionRow>
        </div>
        <Table
          caption="JTAG chain"
          compact
          columns={[
            { key: "i", title: "#", width: 40, render: (_, i) => i },
            { key: "n", title: "Device" },
            { key: "id", title: "IDCODE", mono: true },
            {
              key: "t",
              title: "Type",
              render: (d) => (
                <Badge
                  variant={d.t === "FPGA" ? "teal-subtle" : "purple-subtle"}
                  size="sm"
                >
                  {d.t}
                </Badge>
              ),
            },
          ]}
          rows={devs}
          rowKey={(d) => d.id + d.t}
          isSelected={(d) => d.t === s.dev}
          onRowClick={(d) => !busy && (s.set({ dev: d.t }), setPhase("idle"))}
        />
      </Fieldset>

      <Fieldset
        titleSize={16}
        title="Bitstream"
        subtitle="The file to write to the selected chain device."
        footer={valid ? fname : "No file selected"}
      >
        <OptionRow
          label="File"
          description={
            flash
              ? "Bin or mcs file for Flash."
              : "Bit or bin file for the FPGA."
          }
        >
          <div className="flex w-[360px] gap-2">
            <div className="min-w-0 flex-1">
              <Input
                size="small"
                aria-label="File"
                placeholder="~/vivado/top.bit"
                value={s.path}
                disabled={busy}
                onChange={(e) => (
                  s.set({ path: e.target.value }),
                  setPhase("idle")
                )}
                className="font-mono"
              />
            </div>
            <Button
              type="secondary"
              size="small"
              prefix={<FolderOpen size={16} />}
              disabled={busy}
              onClick={() => setBrowse(true)}
            >
              Browse
            </Button>
          </div>
        </OptionRow>
        <OptionRow
          label="Erase Before Programming"
          description={
            flash
              ? "Clear the device before writing. Needed for Flash."
              : "Only applies to Flash. The FPGA is cleared on every program."
          }
        >
          <Toggle
            aria-label="Erase Before Programming"
            checked={erase}
            disabled={!flash || busy}
            onChange={(e) => s.set({ erase: e })}
          />
        </OptionRow>
        <OptionRow
          label="Verify After Programming"
          description="Read the device back and compare it with the file."
        >
          <Toggle
            aria-label="Verify After Programming"
            checked={s.verify}
            disabled={busy}
            onChange={(verify) => s.set({ verify })}
          />
        </OptionRow>
        <div className="mt-4 flex flex-col gap-2">
          <div className="flex justify-between text-[13px] leading-4 text-gray-900">
            <span aria-live="polite">{status}</span>
            <span className="tabular-nums">
              {phase === "idle" ? "" : `${pct}%`}
            </span>
          </div>
          <Progress
            value={phase === "idle" ? 0 : pct}
            aria-label="Programming progress"
          />
        </div>
      </Fieldset>

      <Fieldset
        titleSize={16}
        title="Recent Programs"
        subtitle="The last runs on this device. Program again to add a row."
      >
        <Table<RunRow>
          caption="Recent programs"
          compact
          columns={[
            { key: "w", title: "When" },
            { key: "f", title: "File", mono: true },
            { key: "d", title: "Device" },
            { key: "t", title: "Duration", align: "right" },
            {
              key: "r",
              title: "Result",
              align: "right",
              render: (r) => (
                <Badge variant={RESULT[r.r]} size="sm">
                  {r.r}
                </Badge>
              ),
            },
          ]}
          rows={s.runs}
          rowKey={(r, i) => r.w + r.f + i}
        />
      </Fieldset>

      <FormModal
        open={browse}
        onClose={() => setBrowse(false)}
        title="Choose Bitstream"
        submitLabel="Choose"
        fields={[
          {
            key: "p",
            label: "File",
            type: "select",
            options: FILES,
            value: FILES.includes(s.path) ? s.path : FILES[0],
          },
        ]}
        onSubmit={(v) => {
          s.set({ path: v.p });
          setPhase("idle");
          setBrowse(false);
        }}
      />
    </ScrollPage>
  );
}
