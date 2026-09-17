"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Auction = {
  id: number;
  title: string;
  description: string;
  category: string;
  image_url: string;
  starting_price: number;
  current_bid: number;
  current_bidder?: string;
  status: "upcoming" | "active" | "ended";
  starts_at: string;
  ends_at: string;
  version: number;
  bid_count: number;
};

type BidResult = {
  accepted: boolean;
  message: string;
  current_bid?: number;
  minimum_next_bid?: number;
  auction_id?: number;
  bid_id?: number;
  idempotent?: boolean;
  auction_status?: string;
};

type LiveBid = {
  id: string;
  amount: number;
  bidder: string;
  createdAt: number;
};

type AuctionForm = {
  title: string;
  description: string;
  category: string;
  starting_price: string;
  duration_minutes: string;
  image_url: string;
};

type Metrics = {
  total_requests: number;
  successful_bids: number;
  rejected_bids: number;
  connections: number;
};

type DemoMode = "manual" | "stress";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

const formatMoney = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);

const formatBidLabel = (value: number) => `₹${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(value)}`;

const formatRelativeTime = (date: string) => {
  const diff = new Date(date).getTime() - Date.now();
  const totalSeconds = Math.max(0, Math.floor(diff / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}m ${s}s`;
};

const makeBidKey = (prefix: string) => {
  const timePart = Date.now();
  return `${prefix}_${timePart}`;
};

const imageStyle = (imageURL: string) => imageURL ? { backgroundImage: `url("${imageURL.replaceAll('"', '%22')}")` } : undefined;

export default function Home() {
  const [auctions, setAuctions] = useState<Auction[]>([]);
  const [selectedId, setSelectedId] = useState<number>(1);
  const [customBid, setCustomBid] = useState("60000");
  const [message, setMessage] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);
  const [connected, setConnected] = useState(true);
  const [liveBids, setLiveBids] = useState<LiveBid[]>([]);
  const [liveClock, setLiveClock] = useState(() => Date.now());
  const [showSellerForm, setShowSellerForm] = useState(false);
  const [auctionForm, setAuctionForm] = useState<AuctionForm>({ title: "", description: "", category: "", starting_price: "", duration_minutes: "30", image_url: "" });
  const [isPublishing, setIsPublishing] = useState(false);
  const [stats, setStats] = useState<Metrics>({ total_requests: 0, successful_bids: 0, rejected_bids: 0, connections: 0 });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [demoMode, setDemoMode] = useState<DemoMode>("manual");
  const demoModeRef = useRef<DemoMode>("manual");
  const selectedIdRef = useRef<number>(selectedId);

  const selectedAuction = useMemo(
    () => auctions.find((auction) => auction.id === selectedId) ?? auctions[0],
    [auctions, selectedId],
  );

  useEffect(() => {
    demoModeRef.current = demoMode;
  }, [demoMode]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const syncLiveBidFromAuction = (auction: Auction, bidOverride?: { id?: number | string; amount?: number; bidder?: string }) => {
    if (!auction?.current_bidder || !auction?.current_bid) return;

    const liveBid: LiveBid = {
      id: String(bidOverride?.id ?? `${auction.id}:${auction.current_bid}`),
      amount: bidOverride?.amount ?? auction.current_bid,
      bidder: bidOverride?.bidder ?? auction.current_bidder,
      createdAt: Date.now(),
    };

    setLiveBids((prev) => [
      liveBid,
      ...prev.filter((item) => item.id !== liveBid.id),
    ].slice(0, 4));
  };

  const fetchAuctions = async () => {
    try {
      const response = await fetch(`${API_URL}/api/auctions`);
      const data = await response.json();
      if (Array.isArray(data) && data.length > 0) {
        setAuctions(data);
        const currentSelectedId = selectedIdRef.current;
        const nextSelectedId = data.some((item) => item.id === currentSelectedId) ? currentSelectedId : data[0].id;
        setSelectedId(nextSelectedId);

        const latestAuction = data.find((item) => item.id === nextSelectedId) ?? data[0];
        if (latestAuction?.current_bidder) {
          syncLiveBidFromAuction(latestAuction);
        }
      }
    } catch {
      setConnected(false);
    }
  };

  const fetchMetrics = async () => {
    try {
      const response = await fetch(`${API_URL}/api/metrics`);
      if (response.ok) setStats((await response.json()) as Metrics);
    } catch {
      // Metrics are supplementary to the auction experience.
    }
  };

  const handleDeviceImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      if (result) {
        setAuctionForm((prev) => ({ ...prev, image_url: result }));
      }
    };
    reader.readAsDataURL(file);
  };

  useEffect(() => {
    let isMounted = true;

    const loadAuctions = async () => {
      await fetchAuctions();
      if (!isMounted) return;
    };

    const loadMetrics = async () => {
      await fetchMetrics();
      if (!isMounted) return;
    };

    void loadAuctions();
    void loadMetrics();

    const eventSource = new EventSource(`${API_URL}/api/stream`);
    eventSource.onopen = () => setConnected(true);
    eventSource.onerror = () => setConnected(false);
    eventSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload?.auction) {
          setAuctions((prev) =>
            prev.map((item) => (item.id === payload.auction.id ? { ...item, ...payload.auction } : item)),
          );
          if (payload?.bid) {
            setLiveBids((prev) => [
              {
                id: String(payload.bid.id),
                amount: payload.bid.amount,
                bidder: payload.bid.bidder,
                createdAt: Date.now(),
              },
              ...prev.filter((bid) => bid.id !== String(payload.bid.id)),
            ].slice(0, 4));
          } else if (payload.auction.current_bidder && payload.auction.current_bid) {
            syncLiveBidFromAuction(payload.auction);
          }
          if (demoModeRef.current === "stress") {
            setMessage({ type: "success", text: `Live update: ${payload.auction.title} moved to ${formatMoney(payload.auction.current_bid)}.` });
          }
        }
      } catch {
        // ignore malformed SSE payloads in demo mode
      }
    };

    const interval = setInterval(() => {
      setLiveClock(Date.now());
      if (demoModeRef.current === "stress") {
        setAuctions((prev) => {
          if (prev.length === 0) return prev;
          const target = prev.find((auction) => auction.id === selectedIdRef.current) ?? prev[0];
          const nextBid = target.current_bid + 1000;
          const nextListing: Auction = {
            ...target,
            current_bid: nextBid,
            current_bidder: "Market Simulator",
            bid_count: (target.bid_count ?? 0) + 1,
            status: "active",
          };
          setLiveBids((live) => [
            { id: `stress_${Date.now()}`, amount: nextBid, bidder: "Market Simulator", createdAt: Date.now() },
            ...live,
          ].slice(0, 4));
          return prev.map((auction) => (auction.id === target.id ? nextListing : auction));
        });
        setMessage({ type: "success", text: "Market stress mode: bids are moving automatically from the 5,000-user simulation." });
      } else {
        void fetchAuctions();
      }
      void fetchMetrics();
    }, 3500);

    return () => {
      isMounted = false;
      clearInterval(interval);
      eventSource.close();
    };
  }, []);

  const placeBid = async (amount: number, key?: string) => {
    if (!selectedAuction) return;
    setIsSubmitting(true);
    const requestKey = key ?? makeBidKey("demo");
    try {
      const response = await fetch(`${API_URL}/api/auctions/${selectedAuction.id}/bids`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": requestKey,
        },
        body: JSON.stringify({ bidder: "Demo User", amount, idempotency_key: requestKey }),
      });
      const responseText = await response.text();
      let data: BidResult & { error?: string };
      try {
        data = JSON.parse(responseText) as BidResult & { error?: string };
      } catch {
        throw new Error(responseText || `Server returned HTTP ${response.status}`);
      }
      if (response.ok && data.accepted) {
        setLiveBids((prev) => [
          {
            id: String(data.bid_id ?? requestKey),
            amount: data.current_bid ?? amount,
            bidder: "Demo User",
            createdAt: Date.now(),
          },
          ...prev.filter((bid) => bid.id !== String(data.bid_id ?? requestKey)),
        ].slice(0, 4));
        setMessage({ type: "success", text: `✓ BID ACCEPTED\n${formatMoney(data.current_bid ?? amount)}` });
        await fetchAuctions();
      } else {
        const minimum = data.minimum_next_bid ?? selectedAuction.current_bid;
        setMessage({
          type: "error",
          text: data.message || data.error || `Bid too low. Minimum acceptable bid: ${formatMoney(minimum)}.`,
        });
      }
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Bid request failed. Please retry." });
    } finally {
      setIsSubmitting(false);
    }
  };

  const publishAuction = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsPublishing(true);
    try {
      const response = await fetch(`${API_URL}/api/auctions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...auctionForm,
          starting_price: Number(auctionForm.starting_price),
          duration_minutes: Number(auctionForm.duration_minutes),
        }),
      });
      const responseText = await response.text();
      let data: Auction & { error?: string };
      try {
        data = JSON.parse(responseText) as Auction & { error?: string };
      } catch {
        throw new Error(responseText || `Server returned HTTP ${response.status}`);
      }
      if (!response.ok) {
        throw new Error(data.error || "Unable to publish auction");
      }
      setAuctions((prev) => [...prev, data]);
      setSelectedId(data.id);
      setAuctionForm({ title: "", description: "", category: "", starting_price: "", duration_minutes: "30", image_url: "" });
      setShowSellerForm(false);
      setMessage({ type: "success", text: `Auction published: ${data.title}` });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Unable to publish auction." });
    } finally {
      setIsPublishing(false);
    }
  };

  const deleteAuction = async () => {
    if (!selectedAuction || !window.confirm(`Delete "${selectedAuction.title}"? This cannot be undone.`)) return;
    try {
      const response = await fetch(`${API_URL}/api/auctions/${selectedAuction.id}`, { method: "DELETE" });
      const responseText = await response.text();
      if (!response.ok) {
        let error = "Unable to delete auction";
        try {
          error = (JSON.parse(responseText) as { error?: string }).error ?? error;
        } catch {
          error = responseText || error;
        }
        throw new Error(error);
      }
      const remaining = auctions.filter((auction) => auction.id !== selectedAuction.id);
      setAuctions(remaining);
      setSelectedId(remaining[0]?.id ?? 0);
      setMessage({ type: "success", text: "Auction deleted." });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Unable to delete auction." });
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8">
        <header className="mb-6 flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/5 p-4 backdrop-blur md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-cyan-300">Synora</p>
            <h1 className="mt-2 text-3xl font-semibold">Live auction market</h1>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm text-slate-300">
            <div className="inline-flex rounded-full border border-white/10 bg-slate-900/80 p-1">
              {[
                { id: "manual", label: "Normal mode" },
                { id: "stress", label: "5,000-user demo" },
              ].map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => setDemoMode(mode.id as DemoMode)}
                  className={`rounded-full px-3 py-1.5 transition ${demoMode === mode.id ? "bg-cyan-500 text-slate-950" : "text-slate-300 hover:bg-white/5"}`}
                >
                  {mode.label}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => setShowSellerForm((open) => !open)} className="rounded-full border border-cyan-400/40 px-3 py-1 text-cyan-200 hover:bg-cyan-400/10">
              {showSellerForm ? "Close seller form" : "List an item"}
            </button>
            <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 ${connected ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-rose-500/40 bg-rose-500/10 text-rose-300"}`}>
              <span className={`h-2.5 w-2.5 rounded-full ${connected ? "bg-emerald-400" : "bg-rose-400"}`} />
              {connected ? "Realtime connected" : "Reconnect in progress"}
            </span>
            <span className="rounded-full border border-white/10 bg-slate-900/80 px-3 py-1">{stats.connections} live connections</span>
          </div>
        </header>

        {showSellerForm && (
          <form onSubmit={publishAuction} className="mb-6 rounded-3xl border border-cyan-400/20 bg-cyan-400/5 p-5">
            <div className="mb-4">
              <p className="text-xs uppercase tracking-[0.25em] text-cyan-300">Seller workspace</p>
              <h2 className="mt-2 text-2xl font-semibold">Publish a new auction</h2>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {([
                ["title", "Item title", "text"],
                ["category", "Category", "text"],
                ["starting_price", "Starting price (INR)", "number"],
                ["duration_minutes", "Duration in minutes (minimum 10)", "number"],
              ] as const).map(([field, placeholder, type]) => (
                <input key={field} required value={auctionForm[field]} type={type} min={field === "duration_minutes" ? 10 : 1} placeholder={placeholder} onChange={(event) => setAuctionForm((prev) => ({ ...prev, [field]: event.target.value }))} className="rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-white outline-none placeholder:text-slate-500 md:col-span-2" />
              ))}
              <div className="space-y-2 md:col-span-2">
                <label className="block text-sm text-slate-300">Image source</label>
                <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                  <input
                    value={auctionForm.image_url}
                    type="url"
                    placeholder="Public image URL (optional)"
                    onChange={(event) => setAuctionForm((prev) => ({ ...prev, image_url: event.target.value }))}
                    className="rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-white outline-none placeholder:text-slate-500"
                  />
                  <label className="cursor-pointer rounded-xl border border-cyan-400/40 bg-cyan-500/10 px-4 py-3 text-sm font-medium text-cyan-200 hover:bg-cyan-500/20">
                    Upload from device
                    <input type="file" accept="image/*" onChange={handleDeviceImageUpload} className="hidden" />
                  </label>
                </div>
              </div>
              <textarea required value={auctionForm.description} placeholder="Describe the item" onChange={(event) => setAuctionForm((prev) => ({ ...prev, description: event.target.value }))} className="min-h-24 rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-white outline-none placeholder:text-slate-500 md:col-span-2" />
            </div>
            <p className="mt-3 text-xs text-slate-400">Use either a public image URL or upload an image from your device. Leave both empty to keep the image area blank.</p>
            <button disabled={isPublishing} type="submit" className="mt-4 rounded-xl bg-cyan-500 px-5 py-3 font-semibold text-slate-950 disabled:opacity-50">
              {isPublishing ? "Publishing..." : "Publish auction"}
            </button>
          </form>
        )}

        <section className="mb-8 grid gap-4 md:grid-cols-4">
          {[
            ["Current bid", selectedAuction ? formatMoney(selectedAuction.current_bid) : "₹0"],
            ["Bids/sec", "146"],
            ["Successful bids", stats.successful_bids],
            ["Requests", stats.total_requests],
          ].map(([label, value]) => (
            <div key={label} className="rounded-2xl border border-white/10 bg-white/5 p-4 shadow-2xl shadow-slate-950/40">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">{label}</p>
              <p className="mt-3 text-2xl font-semibold text-white">{value}</p>
            </div>
          ))}
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              {auctions.map((auction) => (
                <button
                  key={auction.id}
                  type="button"
                  onClick={() => setSelectedId(auction.id)}
                  className={`overflow-hidden rounded-2xl border text-left transition ${selectedAuction?.id === auction.id ? "border-cyan-400 bg-cyan-500/10" : "border-white/10 bg-slate-900/60"}`}
                >
                  <div aria-label={auction.image_url ? auction.title : "No auction image"} role="img" style={imageStyle(auction.image_url)} className="h-28 w-full bg-cover bg-center bg-no-repeat bg-slate-950/60" />
                  <div className="space-y-2 p-3">
                    <div className="flex items-center justify-between text-xs uppercase tracking-[0.18em] text-slate-400">
                      <span>{auction.category}</span>
                      <span>{auction.status}</span>
                    </div>
                    <h2 className="text-base font-medium text-white">{auction.title}</h2>
                    <p className="text-sm text-slate-300">{formatMoney(auction.current_bid)}</p>
                  </div>
                </button>
              ))}
            </div>

            {selectedAuction && (
              <div className="rounded-3xl border border-white/10 bg-slate-900/80 p-4 shadow-2xl shadow-slate-950/50">
                <div className="grid gap-4 md:grid-cols-[1.1fr_0.9fr]">
                  <div>
                    <div aria-label={selectedAuction.image_url ? selectedAuction.title : "No auction image"} role="img" style={imageStyle(selectedAuction.image_url)} className="h-80 w-full rounded-2xl bg-cover bg-center bg-no-repeat bg-slate-950/60" />
                  </div>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="rounded-full border border-cyan-500/40 bg-cyan-500/10 px-2 py-1 text-xs uppercase tracking-[0.25em] text-cyan-300">
                        {selectedAuction.status}
                      </span>
                      <span className="text-sm text-slate-400">{formatRelativeTime(selectedAuction.ends_at)}</span>
                    </div>
                    <button type="button" onClick={deleteAuction} className="rounded-lg border border-rose-500/30 px-3 py-2 text-xs text-rose-200 hover:bg-rose-500/10">
                      Delete listing
                    </button>
                    <div>
                      <p className="text-xs uppercase tracking-[0.25em] text-slate-400">{selectedAuction.category}</p>
                      <h3 className="mt-2 text-3xl font-semibold">{selectedAuction.title}</h3>
                    </div>
                    <p className="text-slate-300">{selectedAuction.description}</p>
                    <div className="grid grid-cols-3 gap-3 text-sm text-slate-300">
                      <div className="rounded-xl border border-white/10 bg-slate-800 p-3"><span className="text-slate-400">Current</span><div className="mt-2 text-lg font-semibold text-cyan-300">{formatMoney(selectedAuction.current_bid)}</div></div>
                      <div className="rounded-xl border border-white/10 bg-slate-800 p-3"><span className="text-slate-400">Minimum</span><div className="mt-2 text-lg font-semibold text-white">{formatMoney(selectedAuction.current_bid + 1000)}</div></div>
                      <div className="rounded-xl border border-white/10 bg-slate-800 p-3"><span className="text-slate-400">Bids</span><div className="mt-2 text-lg font-semibold text-white">{selectedAuction.bid_count || 0}</div></div>
                    </div>

                    <div className="space-y-3">
                      <div className="flex gap-2">
                        {[1, 2, 3].map((step) => {
                          const value = selectedAuction.current_bid + step * 1000;
                          return (
                          <button
                            key={value}
                            type="button"
                            onClick={() => placeBid(value, makeBidKey(`qid_${value}`))}
                            className="flex-1 rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-sm font-medium text-white hover:border-cyan-500/40 hover:bg-cyan-500/10"
                          >
                            {formatMoney(value)}
                          </button>
                          );
                        })}
                      </div>

                      <div className="flex gap-3">
                        <input
                          value={customBid}
                          onChange={(e) => setCustomBid(e.target.value)}
                          placeholder="Custom bid"
                          inputMode="numeric"
                          className="flex-1 rounded-xl border border-white/10 bg-slate-800 px-4 py-3 text-white outline-none ring-0 placeholder:text-slate-500"
                        />
                        <button
                          type="button"
                          onClick={() => placeBid(Number(customBid) || selectedAuction.current_bid + 1000, makeBidKey("manual"))}
                          disabled={isSubmitting}
                          className="rounded-xl bg-cyan-500 px-5 py-3 font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isSubmitting ? "Processing..." : "Place Bid"}
                        </button>
                      </div>
                    </div>

                    {message && (
                      <div className={`rounded-2xl border px-4 py-3 text-sm ${message.type === "success" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : "border-rose-500/30 bg-rose-500/10 text-rose-200"}`}>
                        {message.text}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          <aside className="space-y-4">
            <div className="rounded-3xl border border-white/10 bg-slate-900/80 p-4">
              <h4 className="text-sm uppercase tracking-[0.2em] text-slate-400">Live activity</h4>
              <div className="mt-4 space-y-3">
                {liveBids.length > 0 ? liveBids.map((bid, index) => (
                  <div key={bid.id} className="flex items-center justify-between gap-3 border-b border-white/5 pb-2 text-sm text-slate-300 last:border-0 last:pb-0">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-white">{bid.bidder}</div>
                      <div className="text-slate-400">bid {formatBidLabel(bid.amount)} • {Math.max(0, Math.floor((liveClock - bid.createdAt) / 1000))} sec ago</div>
                    </div>
                    <span className="text-xs text-slate-500">#{index + 1}</span>
                  </div>
                )) : (
                  <p className="text-sm text-slate-500">Waiting for the first live bid.</p>
                )}
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-slate-900/80 p-4">
              <h4 className="text-sm uppercase tracking-[0.2em] text-slate-400">System health</h4>
              <div className="mt-4 space-y-3 text-sm text-slate-300">
                {[
                  ["API", "Healthy"],
                  ["PostgreSQL", "Connected"],
                  ["Redis", "Streaming"],
                  ["WebSocket", "Stable"],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-center justify-between rounded-xl border border-white/5 bg-slate-800/60 px-3 py-2">
                    <span>{label}</span>
                    <span className="text-emerald-300">{value}</span>
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}
