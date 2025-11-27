import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { APP_LOGO, APP_TITLE, getLoginUrl } from "@/const";
import { useState, useRef, useMemo, useEffect } from "react";

type RiskTier = "low" | "medium" | "high";

interface RiskConfig {
  label: string;
  description: string;
  slotCount: number;
  entryCost: number;
  edgePct: number;
  startingBank: number;
}

const RISK_CONFIG: Record<RiskTier, RiskConfig> = {
  low: {
    label: "Low risk",
    description: "Cheaper entries, gentle swings. Good for testing.",
    slotCount: 12,
    entryCost: 5,
    edgePct: -2,
    startingBank: 300
  },
  medium: {
    label: "Medium risk",
    description: "10-slot baseline board with a moderate house edge.",
    slotCount: 10,
    entryCost: 11,
    edgePct: -8,
    startingBank: 300
  },
  high: {
    label: "High risk",
    description: "Fewer slots, higher entry, bigger swings and payouts.",
    slotCount: 6,
    entryCost: 25,
    edgePct: -20,
    startingBank: 300
  }
};

const BOT_INITIALS = [
  "T",
  "B",
  "J",
  "P",
  "K",
  "M",
  "S",
  "L",
  "R",
  "N",
  "C",
  "D"
];

type Owner = "player" | "bot" | "empty";
type SpinSource = "manual" | "auto30" | "botSingle" | "autoFull";

interface RewardWheelBoardProps {
  tier: RiskTier;
  config: RiskConfig;
  userId?: number;
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function polarToCartesian(
  cx: number,
  cy: number,
  r: number,
  deg: number
): { x: number; y: number } {
  const rad = (deg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(
  cx: number,
  cy: number,
  r: number,
  startDeg: number,
  endDeg: number
): string {
  const start = polarToCartesian(cx, cy, r, startDeg);
  const end = polarToCartesian(cx, cy, r, endDeg);
  const largeArc = endDeg - startDeg <= 180 ? 0 : 1;
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y} Z`;
}

const RewardWheelBoard: React.FC<RewardWheelBoardProps> = ({ tier, config, userId }) => {
  const { slotCount, entryCost, edgePct, startingBank } = config;

  const [points, setPoints] = useState<number>(startingBank);
  const [selected, setSelected] = useState<number[]>([]);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<number | null>(null);
  const [log, setLog] = useState<string>(
    "Tap empty slices to buy spots. Board spins vs bots."
  );
  const [announce, setAnnounce] = useState<string>("");
  const [bots, setBots] = useState<number[]>([]);
  const [botLetters, setBotLetters] = useState<Record<number, string>>({});
  const [autoSpin, setAutoSpin] = useState(true);
  const [botSpinSingle, setBotSpinSingle] = useState(true);
  const [showEV, setShowEV] = useState(true);
  const [totalSpins, setTotalSpins] = useState(0);
  const [totalWagered, setTotalWagered] = useState(0);
  const [totalWon, setTotalWon] = useState(0);
  const [payoutMode] = useState<"auto" | "fixed">("auto");
  const [fixedPayout] = useState<number>(100);
  const [effectsOn, setEffectsOn] = useState(true);
  const [hasInteracted, setHasInteracted] = useState(false);
  const [roundId, setRoundId] = useState(0);
  const [fullBoardSpinId, setFullBoardSpinId] = useState<number | null>(null);
  const [devTimer, setDevTimer] = useState<number>(30);
  const wheelFillTimeMs = tier === "high" ? 15000 : 30000;

  const anglePer = 360 / slotCount;
  const wheelRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const sliceColors = useMemo(() => {
    const palette = [
      "#22c55e",
      "#facc15",
      "#6366f1",
      "#f97316",
      "#ec4899",
      "#06b6d4",
      "#84cc16",
      "#e11d48",
      "#a855f7",
      "#14b8a6",
      "#fbbf24",
      "#3b82f6"
    ];
    return Array.from({ length: slotCount }, (_, i) => palette[i % palette.length]);
  }, [slotCount]);

  const slotLabels = useMemo(
    () => Array.from({ length: slotCount }, (_, i) => i + 1),
    [slotCount]
  );

  const ownerFor = useMemo(() => {
    const map: Record<number, Owner> = {} as any;
    slotLabels.forEach((n) => {
      map[n] = "empty";
    });
    bots.forEach((b) => {
      map[b] = "bot";
    });
    selected.forEach((s) => {
      map[s] = "player";
    });
    return map;
  }, [selected, bots, slotLabels]);

  const playerSpots = selected.length;

  function computePayout(k: number, n: number, stakePer: number): number {
    const wagerNow = k * stakePer;
    if (k === 0) return 0;
    const pWinLocal = k / n;
    if (payoutMode === "fixed") return fixedPayout;
    const raw = (wagerNow / pWinLocal) * (1 + edgePct / 100);
    return Math.round(raw / 5) * 5;
  }

  const payout = computePayout(playerSpots, slotCount, entryCost);
  const potDollars = (
    ((playerSpots + bots.length) * entryCost) /
    100
  ).toFixed(2);

  const k = playerSpots;
  const pWin = k > 0 ? k / slotCount : 0;
  const theoEV = k > 0 ? pWin * payout - entryCost * k : 0;
  const net = totalWon - totalWagered;
  const realizedEV = totalSpins > 0 ? net / totalSpins : 0;

  function seedBotsForRound(sel: number[]): void {
    const labels = Array.from({ length: slotCount }, (_, i) => i + 1);
    const available = labels.filter((s) => !sel.includes(s));
    if (available.length === 0) {
      setBots([]);
      setBotLetters({});
      return;
    }

    const maxInitial = Math.min(2, Math.max(0, available.length - 2));
    if (maxInitial <= 0) {
      setBots([]);
      setBotLetters({});
      return;
    }

    const count = randomInt(0, maxInitial);
    if (count === 0) {
      setBots([]);
      setBotLetters({});
      return;
    }

    const shuffled = [...available].sort(() => Math.random() - 0.5);
    const chosen = shuffled.slice(0, count);

    const newBots: number[] = [];
    const newLetters: Record<number, string> = {};

    chosen.forEach((slot, idx) => {
      const initial = BOT_INITIALS[idx % BOT_INITIALS.length];
      newBots.push(slot);
      newLetters[slot] = initial;
    });

    setBots(newBots);
    setBotLetters(newLetters);
  }

  useEffect(() => {
    const next: number[] = [];
    setSelected(next);
    setResult(null);
    setAnnounce("");
    setPoints(startingBank);
    setRoundId((id) => id + 1);
    setFullBoardSpinId(null);
    setTotalSpins(0);
    setTotalWagered(0);
    setTotalWon(0);
    setHasInteracted(false);
    setLog(`${config.label}: ${config.description}`);
    seedBotsForRound(next);
  }, []);

  // Dev timer countdown
  useEffect(() => {
    setDevTimer(Math.ceil(wheelFillTimeMs / 1000));
    const interval = setInterval(() => {
      setDevTimer((t) => {
        if (t <= 1) {
          return Math.ceil(wheelFillTimeMs / 1000);
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [wheelFillTimeMs]);

  // Auto-spin the wheel when it becomes full. This is triggered only when autoSpin is enabled.
  useEffect(() => {
    if (!autoSpin) return;
    if (spinning) return;
    // require at least one player spot to spin
    if (playerSpots === 0) return;
    const totalFilled = selected.length + bots.length;
    // if board is not full yet, nothing to do
    if (totalFilled < slotCount) return;
    // avoid repeating full-board spin within the same round
    if (fullBoardSpinId === roundId) return;
    setFullBoardSpinId(roundId);
    const timeout = setTimeout(() => {
      spin("autoFull");
    }, 600);
    return () => clearTimeout(timeout);
  }, [
    autoSpin,
    spinning,
    playerSpots,
    selected,
    bots,
    slotCount,
    roundId,
    fullBoardSpinId
  ]);

  // Auto-spin countdown. Drives the 'Next spin in' panel when autoSpin is enabled.
  useEffect(() => {
    const base = Math.ceil(wheelFillTimeMs / 1000);
    setDevTimer(base);
    // If autoSpin is off, only show a static countdown and do not trigger spins
    if (!autoSpin) {
      return;
    }
    let remaining = base;
    const interval = setInterval(() => {
      if (spinning) {
        // Reset countdown when wheel is spinning
        remaining = base;
        setDevTimer(base);
        return;
      }
      remaining -= 1;
      if (remaining <= 0) {
        remaining = base;
        const totalFilled = selected.length + bots.length;
        // Only auto-spin on partially filled boards when the player has bought spots
        if (playerSpots > 0 && totalFilled < slotCount) {
          spin("auto30");
        }
      }
      setDevTimer(remaining);
    }, 1000);
    return () => clearInterval(interval);
  }, [
    autoSpin,
    wheelFillTimeMs,
    spinning,
    playerSpots,
    selected.length,
    bots.length,
    slotCount
  ]);

  function animateTo(
    rotationDeg: number,
    durationMs: number,
    easing = "cubic-bezier(0.22,1,0.36,1)"
  ): Promise<void> {
    return new Promise<void>((resolve) => {
      const wheel = wheelRef.current;
      if (!wheel) {
        resolve();
        return;
      }
      wheel.style.transition = `transform ${durationMs}ms ${easing}`;
      wheel.style.transform = `rotate(${rotationDeg}deg)`;
      const done = () => {
        wheel.removeEventListener("transitionend", done);
        resolve();
      };
      wheel.addEventListener("transitionend", done, { once: true } as any);
    });
  }

  function setRotationInstant(rotationDeg: number): void {
    const wheel = wheelRef.current;
    if (!wheel) return;
    wheel.style.transition = "none";
    wheel.style.transform = `rotate(${rotationDeg}deg)`;
  }

  async function spinSequence(finalTargetDeg: number): Promise<void> {
    const overshoot = randomInt(6, 18);
    const backstep = randomInt(2, 6);
    const micro = [1.8, -1.2, 0.6];

    await animateTo(finalTargetDeg + overshoot, 1400 + randomInt(0, 400));
    await animateTo(
      finalTargetDeg - backstep,
      260,
      "cubic-bezier(0.4, 0, 0.2, 1)"
    );
    await animateTo(
      finalTargetDeg,
      180,
      "cubic-bezier(0.2, 0.8, 0.2, 1)"
    );
    for (const d of micro) {
      await animateTo(finalTargetDeg + d, 110, "linear");
    }
    setRotationInstant(finalTargetDeg);
  }

  function resetBoard(): void {
    const next: number[] = [];
    setSelected(next);
    setResult(null);
    setAnnounce("");
    setRotationInstant(0);
    setLog("New board. Tap empty slices to buy spots.");
    setRoundId((id) => id + 1);
    setFullBoardSpinId(null);
    setHasInteracted(false);
    seedBotsForRound(next);
  }

  function spin(source: SpinSource = "manual"): void {
    if (spinning) return;
    if (playerSpots === 0) {
      setLog("You need at least one spot to spin.");
      return;
    }

    const totalFilled = playerSpots + bots.length;
    // When the board is full, only block manual spins. Autospins will be triggered separately.
    if (totalFilled >= slotCount && source === "manual") {
      setLog("Board is full. Waiting for autonomous spin...");
      return;
    }

    setSpinning(true);
    setResult(null);
    setAnnounce("");

    const picked = randomInt(1, slotCount);
    const targetAngle = (picked - 1) * anglePer;
    const finalDeg = 360 * randomInt(3, 8) + targetAngle;

    const currentOwnerFor = ownerFor;
    const currentBotLetters = botLetters;
    const currentPayout = payout;

    (async () => {
      await spinSequence(finalDeg);
      setResult(picked);
      setTotalSpins((s) => s + 1);

      const owner = currentOwnerFor[picked];
      if (owner === "player") {
        const winAmount = currentPayout;
        setPoints((p) => p + winAmount);
        setTotalWon((w) => w + winAmount);
        setAnnounce(`🎉 YOU WIN ${winAmount}!`);
        setLog(`You won ${winAmount} points on spot ${picked}!`);
      } else if (owner === "bot") {
        const botLetter = currentBotLetters[picked];
        setLog(`Bot ${botLetter} won on spot ${picked}.`);
        setAnnounce("");
      } else {
        setLog(`Empty spot ${picked} landed. No payout.`);
        setAnnounce("");
      }

      setSpinning(false);

      await new Promise((resolve) => setTimeout(resolve, 2000));
      resetBoard();
    })();
  }

  function buySpot(slot: number): void {
    if (selected.includes(slot)) {
      setLog("You already own that spot.");
      return;
    }
    if (bots.includes(slot)) {
      setLog("That spot is taken by a bot.");
      return;
    }
    if (points < entryCost) {
      setLog("Not enough points to buy a spot.");
      return;
    }

    setHasInteracted(true);

    // Immediately apply the player's purchase without delay
    const next = [...selected, slot];
    setSelected(next);
    setPoints((p) => p - entryCost);
    setTotalWagered((w) => w + entryCost);
    setLog(`Bought spot ${slot}. You now have ${next.length} spot(s).`);

    // Stagger bot joins with a small delay to simulate natural pacing
    const botDelayMs = 150 + Math.random() * 850;
    setTimeout(() => {
      setBots((prevBots) => {
        const taken = new Set<number>([...prevBots, ...next]);
        const empties = slotLabels.filter((s) => !taken.has(s));
        if (!empties.length) return prevBots;

        const joinChance =
          tier === "low" ? 0.15 : tier === "medium" ? 0.4 : 0.65;
        if (Math.random() > joinChance) return prevBots;

        const maxNew = tier === "high" ? 2 : 1;
        const newCount = Math.min(maxNew, empties.length);
        if (newCount <= 0) return prevBots;

        const shuffled = [...empties].sort(() => Math.random() - 0.5);
        const chosen = shuffled.slice(0, newCount);

        const updated = [...prevBots];
        const newLetters: Record<number, string> = {};

        if (tier === "high") {
          const initial =
            BOT_INITIALS[randomInt(0, BOT_INITIALS.length - 1)];
          chosen.forEach((s) => {
            updated.push(s);
            newLetters[s] = initial;
          });
        } else {
          chosen.forEach((s, idx) => {
            const initial = BOT_INITIALS[idx % BOT_INITIALS.length];
            updated.push(s);
            newLetters[s] = initial;
          });
        }

        setBotLetters((prev) => ({ ...prev, ...newLetters }));
        return updated;
      });
    }, botDelayMs);
  }

  function pointToSlot(clientX: number, clientY: number): number | null {
    const svg = svgRef.current;
    if (!svg) return null;

    const rect = svg.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const cx = rect.width / 2;
    const cy = rect.height / 2;

    const dx = x - cx;
    const dy = y - cy;
    const angle = Math.atan2(dy, dx) * (180 / Math.PI) + 90;
    const normalizedAngle = ((angle % 360) + 360) % 360;

    const slotIndex = Math.floor(normalizedAngle / anglePer);
    return slotIndex + 1;
  }

  function handleSvgClick(e: React.MouseEvent<SVGSVGElement>): void {
    const slot = pointToSlot(e.clientX, e.clientY);
    if (slot !== null && ownerFor[slot] === "empty") {
      buySpot(slot);
    }
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-b from-slate-950 to-slate-900 p-4">
      <div className="w-full max-w-6xl">
        <h1 className="text-4xl font-bold text-center text-white mb-2">
          Reward Wheel vs Bots
        </h1>
        <p className="text-center text-slate-400 mb-8">
          Buy slices, let bots trickle in, and spin. Full boards auto-spin and clear.
        </p>

        <div className="flex gap-4 justify-center mb-8">
          {(["low", "medium", "high"] as const).map((t) => (
            <button
              key={t}
              onClick={() => window.location.reload()}
              className={`px-6 py-2 rounded-full font-semibold transition ${
                tier === t
                  ? "bg-emerald-500 text-white"
                  : "bg-slate-700 text-slate-300 hover:bg-slate-600"
              }`}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2">
            <div className="bg-slate-800 rounded-2xl p-8 border border-slate-700">
              <div className="text-center mb-4">
                <h2 className="text-xl font-bold text-slate-300 uppercase tracking-wide">
                  {config.label}
                </h2>
                <p className="text-sm text-slate-400 mt-2">
                  YOUR SPOTS: {playerSpots}/{slotCount}
                </p>
              </div>

              <div className="flex justify-center mb-8">
                <div
                  ref={wheelRef}
                  className="w-96 h-96 relative"
                  style={{ transform: "rotate(0deg)" }}
                >
                  <svg
                    ref={svgRef}
                    viewBox="0 0 400 400"
                    className="w-full h-full cursor-pointer drop-shadow-2xl"
                    onClick={handleSvgClick}
                  >
                    <defs>
                      <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">
                        <feDropShadow
                          dx="0"
                          dy="4"
                          stdDeviation="6"
                          floodOpacity="0.4"
                        />
                      </filter>
                    </defs>

                    {slotLabels.map((slot) => {
                      const startDeg = (slot - 1) * anglePer;
                      const endDeg = startDeg + anglePer;
                      const path = arcPath(200, 200, 160, startDeg, endDeg);
                      const owner = ownerFor[slot];
                      const color = sliceColors[slot - 1];

                      return (
                        // Make each slice group clickable for improved reactivity
                        <g
                          key={slot}
                          className="cursor-pointer"
                          onClick={() => {
                            if (ownerFor[slot] === "empty") {
                              buySpot(slot);
                            }
                          }}
                        >
                          <path
                            d={path}
                            fill={color}
                            stroke="#000"
                            strokeWidth="2"
                            opacity={owner === "empty" ? 0.3 : 1}
                            // Toggle drop-shadow based on effectsOn flag
                            filter={effectsOn ? "url(#shadow)" : undefined}
                          />
                          <circle
                            cx={200 + 110 * Math.cos((startDeg + anglePer / 2) * (Math.PI / 180))}
                            cy={200 + 110 * Math.sin((startDeg + anglePer / 2) * (Math.PI / 180))}
                            r="24"
                            fill="#1a1a2e"
                            stroke="#00ff88"
                            strokeWidth="2"
                          />
                          <text
                            x={200 + 110 * Math.cos((startDeg + anglePer / 2) * (Math.PI / 180))}
                            y={200 + 110 * Math.sin((startDeg + anglePer / 2) * (Math.PI / 180))}
                            textAnchor="middle"
                            dominantBaseline="middle"
                            className="text-lg font-bold fill-white"
                          >
                            {owner === "empty" ? "+" : owner === "player" ? "U" : botLetters[slot]}
                          </text>
                        </g>
                      );
                    })}

                    <circle cx="200" cy="200" r="80" fill="#0f172a" stroke="#00ff88" strokeWidth="3" />
                    <text
                      x="200"
                      y="185"
                      textAnchor="middle"
                      className="text-sm fill-slate-400 font-semibold"
                    >
                      POT
                    </text>
                    <text
                      x="200"
                      y="215"
                      textAnchor="middle"
                      className="text-2xl fill-white font-bold"
                    >
                      ${potDollars}
                    </text>
                  </svg>

                  <div className="absolute top-0 left-1/2 transform -translate-x-1/2 -translate-y-2">
                    <div className="w-8 h-8 bg-white rounded-full border-4 border-slate-900 shadow-lg" />
                  </div>
                </div>
              </div>

              {result && (
                <div className="text-center mb-4">
                  <p className="text-slate-400 text-sm">Result: {result}</p>
                </div>
              )}

              {announce && (
                <div className="text-center mb-4 animate-bounce">
                  <p className="text-2xl font-bold text-emerald-400">{announce}</p>
                </div>
              )}

              <div className="text-center mb-6">
                <p className="text-slate-300">{log}</p>
              </div>

              <div className="flex gap-4 justify-center mb-6">
                <button
                  onClick={() => spin("manual")}
                  disabled={spinning || playerSpots === 0}
                  className="px-8 py-3 bg-emerald-500 text-white font-bold rounded-lg hover:bg-emerald-600 disabled:bg-slate-600 disabled:cursor-not-allowed transition"
                >
                  {spinning ? "Spinning..." : "Spin"}
                </button>
                <button
                  onClick={resetBoard}
                  className="px-8 py-3 bg-slate-700 text-white font-bold rounded-lg hover:bg-slate-600 transition"
                >
                  New board
                </button>
              </div>

              <div className="text-center mb-6">
                <p className="text-lg font-bold text-white">
                  Price to enter: ${(entryCost / 100).toFixed(2)}
                </p>
              </div>

              <div className="text-center mb-6">
                <p className="text-lg font-bold text-emerald-400">
                  Points: {points}
                </p>
              </div>

              <div className="flex gap-4 justify-center flex-wrap">
                <button
                  onClick={() => setAutoSpin(!autoSpin)}
                  className={`px-4 py-2 rounded-lg font-semibold transition ${
                    autoSpin
                      ? "bg-emerald-500 text-white"
                      : "bg-slate-700 text-slate-300"
                  }`}
                >
                  Auto 30s
                </button>
                <button
                  onClick={() => setBotSpinSingle(!botSpinSingle)}
                  className={`px-4 py-2 rounded-lg font-semibold transition ${
                    botSpinSingle
                      ? "bg-blue-500 text-white"
                      : "bg-slate-700 text-slate-300"
                  }`}
                >
                  Bot cadence (1 spot)
                </button>
                <button
                  onClick={() => setShowEV(!showEV)}
                  className={`px-4 py-2 rounded-lg font-semibold transition ${
                    showEV
                      ? "bg-yellow-500 text-white"
                      : "bg-slate-700 text-slate-300"
                  }`}
                >
                  EV panel
                </button>
                <button
                  onClick={() => setEffectsOn(!effectsOn)}
                  className={`px-4 py-2 rounded-lg font-semibold transition ${
                    effectsOn
                      ? "bg-pink-500 text-white"
                      : "bg-slate-700 text-slate-300"
                  }`}
                >
                  FX
                </button>
              </div>
            </div>
          </div>

          <div className="lg:col-span-1">
            <div className="bg-slate-800 rounded-2xl p-6 border border-slate-700 sticky top-4">
              <div className="flex gap-2 mb-6">
                <button className="flex-1 px-4 py-2 bg-emerald-500 text-white font-semibold rounded-lg">
                  Recent wins
                </button>
                <button className="flex-1 px-4 py-2 bg-slate-700 text-slate-300 font-semibold rounded-lg">
                  My wins
                </button>
                <button className="flex-1 px-4 py-2 bg-slate-700 text-slate-300 font-semibold rounded-lg">
                  My bets
                </button>
              </div>

              <div className="space-y-4">
                <div className="bg-slate-900 rounded-lg p-4">
                  <h3 className="text-sm font-semibold text-slate-400 uppercase mb-3">
                    Status
                  </h3>
                  <p className="text-sm text-slate-300">
                    {config.label}: {config.description}
                  </p>
                  <div className="mt-4 pt-4 border-t border-slate-700">
                    <p className="text-xs font-semibold text-slate-400 uppercase mb-2">Next Spin In</p>
                    <p className="text-3xl font-bold text-emerald-400">{devTimer}s</p>
                  </div>
                </div>

                {showEV && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-slate-900 rounded-lg p-4">
                      <h4 className="text-xs font-semibold text-slate-400 uppercase">
                        Theoretical
                      </h4>
                      <p className="text-sm text-slate-300 mt-2">
                        Spots: {k}
                      </p>
                      <p className="text-sm text-slate-300">
                        Win chance: {(pWin * 100).toFixed(1)}%
                      </p>
                      <p className="text-sm text-slate-300">
                        EV / round: {theoEV.toFixed(2)} pts
                      </p>
                    </div>

                    <div className="bg-slate-900 rounded-lg p-4">
                      <h4 className="text-xs font-semibold text-slate-400 uppercase">
                        Session
                      </h4>
                      <p className="text-sm text-slate-300 mt-2">
                        Spins: {totalSpins}
                      </p>
                      <p className="text-sm text-slate-300">
                        Entries paid: {totalWagered}
                      </p>
                      <p className="text-sm text-slate-300">
                        Won: {totalWon}
                      </p>
                      <p className="text-sm text-slate-300">
                        Net: {net} ({realizedEV.toFixed(2)} avg/spin)
                      </p>
                    </div>
                  </div>
                )}

                <div className="bg-slate-900 rounded-lg p-4">
                  <h3 className="text-sm font-semibold text-slate-400 uppercase mb-3">
                    User
                  </h3>
                  <div className="space-y-2">
                    {[...bots.map((b) => ({ slot: b, type: "bot" as const })), ...selected.map((s) => ({ slot: s, type: "player" as const }))].map(({ slot, type }) => (
                      <div key={slot} className="flex justify-between items-center text-sm">
                        <div className="flex items-center gap-2">
                          <div
                            className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
                            style={{
                              backgroundColor: sliceColors[slot - 1],
                              color: "#000"
                            }}
                          >
                            {type === "player" ? "U" : botLetters[slot]}
                          </div>
                          <span className="text-slate-300">
                            {type === "player" ? "You" : `Bot ${botLetters[slot]}`}
                          </span>
                        </div>
                        <div className="text-right">
                          <p className="text-slate-300">
                            Spots: {type === "player" ? selected.length : 1}
                          </p>
                          <p className="text-slate-400 text-xs">
                            {((type === "player" ? selected.length : 1) / slotCount * 100).toFixed(0)}% chance
                          </p>
                        </div>
                      </div>
                    ))}
                    {selected.length + bots.length < slotCount && (
                      <div className="text-center py-2">
                        <p className="text-slate-400 text-sm">
                          Waiting for player...
                        </p>
                        <button
                          onClick={() => {
                            const empties = slotLabels.filter(
                              (s) => !selected.includes(s) && !bots.includes(s)
                            );
                            if (empties.length > 0) {
                              buySpot(empties[0]);
                            }
                          }}
                          className="mt-2 px-4 py-1 bg-emerald-500 text-white text-sm font-semibold rounded"
                        >
                          Enter
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default function Home() {
  const { user } = useAuth();

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-white mb-4">Reward Wheel Game</h1>
          <p className="text-slate-400 mb-8">Sign in to play</p>
          <a
            href={getLoginUrl()}
            className="px-8 py-3 bg-emerald-500 text-white font-bold rounded-lg hover:bg-emerald-600"
          >
            Sign In
          </a>
        </div>
      </div>
    );
  }

  return (
    <RewardWheelBoard
      tier="medium"
      config={RISK_CONFIG.medium}
      userId={user.id}
    />
  );
}
