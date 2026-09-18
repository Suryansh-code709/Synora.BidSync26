"use client";

import { BrowserProvider } from "ethers";
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
  active_auctions?: number;
  average_bid?: number;
  requests_per_second?: string | number;
  bids_per_second?: string | number;
  load_index?: string | number;
  last_updated?: string;
};

type FilterMode = "all" | "active" | "ending-soon" | "upcoming" | "ended";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
const POLYGON_NETWORK = "Polygon";

const filterOptions: { id: FilterMode; label: string }[] = [
  { id: "all", label: "All" },
  { id: "active", label: "Live" },
  { id: "ending-soon", label: "Ending soon" },
  { id: "upcoming", label: "Upcoming" },
  { id: "ended", label: "Ended" },
];

const formatMoney = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);

const formatBidLabel = (value: number) => `₹${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(value)}`;

const formatMaskedAddress = (address: string) => {
  if (!address) return "Anonymous wallet";
  const trimmed = address.trim();
  if (trimmed.length <= 10) return trimmed;
  return `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`;
};

const buildWalletMessage = (auctionId: number, amount: number, requestKey: string) =>
  `BidSync market approval\nAuction:${auctionId}\nBid:${amount}\nKey:${requestKey}`;

const getAuctionStartCountdown = (auction: Auction) => {
  const remainingMs = new Date(auction.starts_at).getTime() - Date.now();
  if (remainingMs <= 0) return 0;
  return Math.max(0, Math.ceil(remainingMs / 1000));
};

const getAuctionCountdown = (auction: Auction) => {
  const startCountdown = getAuctionStartCountdown(auction);
  if (auction.status === "upcoming" && startCountdown > 0) {
    return `Starts in ${startCountdown}s`;
  }

  const diff = new Date(auction.ends_at).getTime() - Date.now();
  const totalSeconds = Math.max(0, Math.floor(diff / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m ${seconds}s`;
};

const makeBidKey = (prefix: string) => {
  const timePart = Date.now();
  return `${prefix}_${timePart}`;
};

const imageStyle = (imageURL: string) => (imageURL ? { backgroundImage: `url("${imageURL}")` } : undefined);

export default function Home() {
  const [auctions, setAuctions] = useState<Auction[]>([]);
  const [selectedId, setSelectedId] = useState<number>(1);
  const [customBid, setCustomBid] = useState("60000");
  const [message, setMessage] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);
  const [connected, setConnected] = useState(true);
  const [liveBids, setLiveBids] = useState<LiveBid[]>([]);
  const [liveClock, setLiveClock] = useState(() => Date.now());
  const [showSellerForm, setShowSellerForm] = useState(false);
  const [auctionForm, setAuctionForm] = useState<AuctionForm>({
    title: "",
    description: "",
    category: "",
    starting_price: "",
    duration_minutes: "30",
    image_url: "",
  });
  const [isPublishing, setIsPublishing] = useState(false);
  const [stats, setStats] = useState<Metrics>({
    total_requests: 0,
    successful_bids: 0,
    rejected_bids: 0,
    connections: 0,
    active_auctions: 0,
    requests_per_second: 0,
    bids_per_second: 0,
    load_index: 0,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [watchlist, setWatchlist] = useState<number[]>([]);
  const [walletConnected, setWalletConnected] = useState(false);
  const [walletAddress, setWalletAddress] = useState("");
  const [walletNetwork, setWalletNetwork] = useState(POLYGON_NETWORK);
  const [connectingWallet, setConnectingWallet] = useState(false);
  const selectedIdRef = useRef<number>(selectedId);

  const selectedAuction = useMemo(
    () => auctions.find((auction) => auction.id === selectedId) ?? auctions[0],
    [auctions, selectedId],
  );

  const endedAuctions = useMemo(
    () => [...auctions].filter((auction) => auction.status === "ended" || new Date(auction.ends_at).getTime() <= Date.now()),
    [auctions],
  );

  const filteredAuctions = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();

    return [...auctions]
      .filter((auction) => {
        const matchesSearch = !normalizedSearch || [auction.title, auction.category, auction.description].join(" ").toLowerCase().includes(normalizedSearch);
        const now = Date.now();
        const endsInMs = new Date(auction.ends_at).getTime() - now;
        const endingSoon = endsInMs <= 10 * 60 * 1000 && endsInMs > 0;
        const isEnded = auction.status === "ended" || new Date(auction.ends_at).getTime() <= now;

        if (filterMode === "active") return matchesSearch && !isEnded && auction.status === "active";
        if (filterMode === "ending-soon") return matchesSearch && !isEnded && endingSoon;
        if (filterMode === "upcoming") return matchesSearch && !isEnded && auction.status === "upcoming";
        if (filterMode === "ended") return matchesSearch && isEnded;
        return matchesSearch && !isEnded;
      })
      .sort((a, b) => new Date(a.ends_at).getTime() - new Date(b.ends_at).getTime());
  }, [auctions, filterMode, searchTerm]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    if (filteredAuctions.length === 0) return;
    if (!filteredAuctions.some((auction) => auction.id === selectedId)) {
      setSelectedId(filteredAuctions[0].id);
    }
  }, [filteredAuctions, selectedId]);

  const refreshAll = async () => {
    setConnected(true);
    await Promise.all([fetchAuctions(), fetchMetrics()]);
    setMessage({ type: "info", text: "Marketplace refreshed." });
  };

  const auctionEnded = selectedAuction ? selectedAuction.status === "ended" || new Date(selectedAuction.ends_at).getTime() <= Date.now() : false;

  const upsertLiveBid = (liveBid: LiveBid) => {
    setLiveBids((prev) => {
      const deduped = prev.filter((item) => !(item.bidder === liveBid.bidder && item.amount === liveBid.amount && item.id !== liveBid.id));
      return [liveBid, ...deduped.filter((item) => item.id !== liveBid.id)].slice(0, 4);
    });
  };

  const syncLiveBidFromAuction = (auction: Auction, bidOverride?: { id?: number | string; amount?: number; bidder?: string }) => {
    if (!auction?.current_bidder || !auction?.current_bid) return;

    const liveBid: LiveBid = {
      id: String(bidOverride?.id ?? `${auction.id}:${auction.current_bidder}:${auction.current_bid}`),
      amount: bidOverride?.amount ?? auction.current_bid,
      bidder: bidOverride?.bidder ?? auction.current_bidder,
      createdAt: Date.now(),
    };

    upsertLiveBid(liveBid);
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

  const connectWallet = async () => {
    if (typeof window === "undefined") {
      setMessage({ type: "error", text: "Wallet connection is only available in the browser." });
      return;
    }

    const ethereum = (window as any).ethereum;
    if (!ethereum) {
      setMessage({ type: "error", text: "MetaMask or another Polygon wallet is required." });
      return;
    }

    try {
      setConnectingWallet(true);
      const provider = new BrowserProvider(ethereum);
      const accounts = await provider.send("eth_requestAccounts", []);
      const signer = await provider.getSigner();
      const address = await signer.getAddress();
      const network = await provider.getNetwork();
      setWalletAddress(address);
      setWalletNetwork(network?.name ? network.name : POLYGON_NETWORK);
      setWalletConnected(true);
      setMessage({ type: "success", text: `Wallet connected: ${formatMaskedAddress(address)}` });
      if (accounts?.length === 0) {
        setWalletConnected(false);
      }
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Wallet connection was rejected.",
      });
    } finally {
      setConnectingWallet(false);
    }
  };

  const disconnectWallet = () => {
    setWalletConnected(false);
    setWalletAddress("");
    setWalletNetwork(POLYGON_NETWORK);
    setMessage({ type: "info", text: "Wallet disconnected. Connect a Polygon wallet to continue." });
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
            upsertLiveBid({
              id: String(payload.bid.id),
              amount: payload.bid.amount,
              bidder: payload.bid.bidder,
              createdAt: Date.now(),
            });
          } else if (payload.auction.current_bidder && payload.auction.current_bid) {
            syncLiveBidFromAuction(payload.auction);
          }
        }
      } catch {
        // ignore malformed SSE payloads in the market stream
      }
    };

    const interval = setInterval(() => {
      setLiveClock(Date.now());
      void fetchAuctions();
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
    if (!walletConnected || !walletAddress) {
      setMessage({ type: "error", text: "Connect your Polygon wallet to participate anonymously in the market." });
      return;
    }

    setIsSubmitting(true);
    const requestKey = key ?? makeBidKey("market");
    const walletMessage = buildWalletMessage(selectedAuction.id, amount, requestKey);

    try {
      const ethereum = (window as any).ethereum;
      if (!ethereum) throw new Error("Wallet provider not found.");
      const provider = new BrowserProvider(ethereum);
      const signer = await provider.getSigner();
      const signature = await signer.signMessage(walletMessage);

      const response = await fetch(`${API_URL}/api/auctions/${selectedAuction.id}/bids`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": requestKey,
        },
        body: JSON.stringify({
          bidder: formatMaskedAddress(walletAddress),
          amount,
          idempotency_key: requestKey,
          wallet_address: walletAddress,
          wallet_network: walletNetwork,
          signature,
        }),
      });
      const responseText = await response.text();
      let data: BidResult & { error?: string };
      try {
        data = JSON.parse(responseText) as BidResult & { error?: string };
      } catch {
        throw new Error(responseText || `Server returned HTTP ${response.status}`);
      }
      if (response.ok && data.accepted) {
        upsertLiveBid({
          id: String(data.bid_id ?? requestKey),
          amount: data.current_bid ?? amount,
          bidder: formatMaskedAddress(walletAddress),
          createdAt: Date.now(),
        });
        setMessage({ type: "success", text: `Wallet verified bid accepted for ${formatMoney(data.current_bid ?? amount)}` });
        await fetchAuctions();
      } else {
        const minimum = data.minimum_next_bid ?? selectedAuction.current_bid;
        setMessage({
          type: "error",
          text: data.message || data.error || `Bid too low. Minimum acceptable bid: ${formatMoney(minimum)}.`,
        });
      }
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Wallet bid failed. Please retry." });
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
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(34,211,238,0.18),_transparent_30%),linear-gradient(180deg,_#020817_0%,_#0f172a_100%)] text-white">
      <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8">
        <header className="mb-6 flex flex-col gap-4 rounded-[28px] border border-white/10 bg-slate-900/70 p-4 shadow-[0_24px_80px_rgba(14,165,233,0.12)] backdrop-blur md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.4em] text-cyan-300">BidSync</p>
            <h1 className="mt-2 text-3xl font-semibold">Anonymous Polygon marketplace</h1>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-sm text-slate-300">
            <button
              type="button"
              onClick={walletConnected ? disconnectWallet : connectWallet}
              disabled={connectingWallet}
              className="rounded-full bg-gradient-to-r from-cyan-400 to-emerald-400 px-4 py-2 font-semibold text-slate-950 shadow-lg shadow-cyan-500/20 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {connectingWallet ? "Connecting..." : walletConnected ? "Wallet connected" : "Connect Polygon wallet"}
            </button>

            {walletConnected && (
              <span className="rounded-full border border-emerald-400/40 bg-emerald-500/10 px-3 py-1 text-emerald-200">
                {formatMaskedAddress(walletAddress)} • {walletNetwork}
              </span>
            )}

            <button type="button" onClick={() => setShowSellerForm((open) => !open)} className="rounded-full border border-cyan-400/40 bg-cyan-500/10 px-3 py-1 text-cyan-200 hover:bg-cyan-500/20">
              {showSellerForm ? "Close seller form" : "List an item"}
            </button>
            <button type="button" onClick={refreshAll} className="rounded-full border border-white/10 bg-slate-950/70 px-3 py-1 text-slate-200 hover:bg-white/5">
              Refresh market
            </button>
            <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 ${connected ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-rose-500/40 bg-rose-500/10 text-rose-300"}`}>
              <span className={`h-2.5 w-2.5 rounded-full ${connected ? "bg-emerald-400" : "bg-rose-400"}`} />
              {connected ? "Realtime connected" : "Reconnect"}
            </span>
          </div>
        </header>

        {showSellerForm && (
          <form onSubmit={publishAuction} className="mb-6 rounded-[28px] border border-cyan-400/20 bg-cyan-500/5 p-5">
            <div className="mb-4">
              <p className="text-xs uppercase tracking-[0.25em] text-cyan-300">Seller workspace</p>
              <h2 className="mt-2 text-2xl font-semibold">Publish a new listing</h2>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {([
                ["title", "Item title", "text"],
                ["category", "Category", "text"],
                ["starting_price", "Starting price (INR)", "number"],
                ["duration_minutes", "Duration in minutes (minimum 10)", "number"],
              ] as const).map(([field, placeholder, type]) => (
                <input
                  key={field}
                  required
                  value={auctionForm[field]}
                  type={type}
                  min={field === "duration_minutes" ? 10 : 1}
                  placeholder={placeholder}
                  onChange={(event) => setAuctionForm((prev) => ({ ...prev, [field]: event.target.value }))}
                  className="rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-white outline-none placeholder:text-slate-500 md:col-span-2"
                />
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
              <textarea
                required
                value={auctionForm.description}
                placeholder="Describe the item"
                onChange={(event) => setAuctionForm((prev) => ({ ...prev, description: event.target.value }))}
                className="min-h-24 rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-white outline-none placeholder:text-slate-500 md:col-span-2"
              />
            </div>
            <button disabled={isPublishing} type="submit" className="mt-4 rounded-xl bg-cyan-500 px-5 py-3 font-semibold text-slate-950 disabled:opacity-50">
              {isPublishing ? "Publishing..." : "Publish listing"}
            </button>
          </form>
        )}

        <section className="mb-8 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          {[
            ["Current bid", selectedAuction ? formatMoney(selectedAuction.current_bid) : "₹0"],
            ["Load / sec", `${Number(stats.requests_per_second ?? 0).toFixed(2)}`],
            ["Bid throughput", `${Number(stats.bids_per_second ?? 0).toFixed(2)}/s`],
            ["Successful bids", stats.successful_bids],
            ["Connections", stats.connections],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-2xl border border-white/10 bg-white/5 p-4 shadow-2xl shadow-slate-950/40">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">{String(label)}</p>
              <p className="mt-3 text-xl font-semibold text-white">{String(value)}</p>
            </div>
          ))}
        </section>

        <section className="mb-8 grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Market load</p>
              <span className="text-sm text-cyan-300">{Number(stats.load_index ?? 0).toFixed(0)}%</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-slate-800">
              <div className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-emerald-400" style={{ width: `${Math.min(100, Number(stats.load_index ?? 0))}%` }} />
            </div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Bid pressure</p>
              <span className="text-sm text-amber-300">{Number(stats.bids_per_second ?? 0).toFixed(2)}/s</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-slate-800">
              <div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-rose-400" style={{ width: `${Math.min(100, Number(stats.bids_per_second ?? 0) * 25)}%` }} />
            </div>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-4">
            <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-3">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-1 items-center gap-3 rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2">
                  <span className="text-slate-400">⌕</span>
                  <input
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    placeholder="Search item, category, or description"
                    className="w-full border-0 bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  {filterOptions.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setFilterMode(option.id)}
                      className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${filterMode === option.id ? "bg-cyan-500 text-slate-950" : "border border-white/10 bg-slate-950/70 text-slate-300 hover:bg-white/5"}`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {filteredAuctions.map((auction) => {
                const isWatched = watchlist.includes(auction.id);
                return (
                  <div
                    key={auction.id}
                    onClick={() => setSelectedId(auction.id)}
                    className={`cursor-pointer overflow-hidden rounded-2xl border text-left transition ${selectedAuction?.id === auction.id ? "border-cyan-400 bg-cyan-500/10" : "border-white/10 bg-slate-900/60"}`}
                  >
                    <div className="relative">
                      <div aria-label={auction.image_url ? auction.title : "No auction image"} role="img" style={imageStyle(auction.image_url)} className="h-28 w-full bg-cover bg-center bg-no-repeat bg-slate-950/60" />
                      {auction.status === "upcoming" && (
                        <div className="absolute inset-0 flex items-center justify-center bg-slate-950/60 backdrop-blur-[1px]">
                          <div className="flex flex-col items-center justify-center text-center">
                            <span className="text-3xl">🔨</span>
                            <span className="mt-1 text-lg font-semibold text-amber-300">{getAuctionStartCountdown(auction)}</span>
                          </div>
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setWatchlist((prev) => prev.includes(auction.id) ? prev.filter((id) => id !== auction.id) : [...prev, auction.id]);
                        }}
                        aria-label={isWatched ? "Remove from favorites" : "Add to favorites"}
                        className={`absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full text-lg transition ${isWatched ? "bg-amber-400 text-slate-950" : "bg-slate-950/70 text-slate-200 hover:bg-slate-800"}`}
                      >
                        {isWatched ? "★" : "☆"}
                      </button>
                    </div>
                    <div className="space-y-2 p-3">
                      <div className="flex items-center justify-between gap-2 text-xs uppercase tracking-[0.18em] text-slate-400">
                        <span>{auction.category}</span>
                        <span>{auction.status}</span>
                      </div>
                      <h2 className="text-base font-medium text-white">{auction.title}</h2>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-slate-300">{formatMoney(auction.current_bid)}</span>
                        <span className="text-cyan-300">{getAuctionCountdown(auction)}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {filteredAuctions.length === 0 && (
              <div className="rounded-2xl border border-dashed border-white/10 bg-slate-900/50 p-8 text-center text-slate-400">
                No auctions match your current filters. Try another category or clear your search.
              </div>
            )}

            {endedAuctions.length > 0 && (
              <div className="rounded-3xl border border-white/10 bg-slate-900/80 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm uppercase tracking-[0.2em] text-slate-400">Ended listings</h3>
                  <span className="rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-xs text-rose-200">{endedAuctions.length}</span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {endedAuctions.map((auction) => (
                    <button
                      key={auction.id}
                      type="button"
                      onClick={() => setSelectedId(auction.id)}
                      className={`rounded-2xl border border-rose-500/20 bg-rose-500/5 p-3 text-left transition hover:bg-rose-500/10 ${selectedAuction?.id === auction.id ? "ring-1 ring-rose-400/60" : ""}`}
                    >
                      <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-[0.18em] text-slate-400">
                        <span>{auction.category}</span>
                        <span>ended</span>
                      </div>
                      <h4 className="text-base font-medium text-white">{auction.title}</h4>
                      <p className="mt-2 text-sm font-medium text-amber-200">Winner: {auction.current_bidder || "No winner"}</p>
                      <p className="mt-1 text-sm text-slate-300">Final bid: {formatMoney(auction.current_bid)}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {selectedAuction && (
              <div className="rounded-3xl border border-white/10 bg-slate-900/80 p-4 shadow-2xl shadow-slate-950/50">
                <div className="grid gap-4 md:grid-cols-[1.1fr_0.9fr]">
                  <div>
                    <div aria-label={selectedAuction.image_url ? selectedAuction.title : "No auction image"} role="img" style={imageStyle(selectedAuction.image_url)} className="h-80 w-full rounded-2xl bg-cover bg-center bg-no-repeat bg-slate-950/60" />
                  </div>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between gap-3">
                      <span className="rounded-full border border-cyan-500/40 bg-cyan-500/10 px-2 py-1 text-xs uppercase tracking-[0.25em] text-cyan-300">
                        {selectedAuction.status}
                      </span>
                      <span className="text-sm text-slate-400">
                        {selectedAuction.status === "upcoming" ? `Starts in ${getAuctionStartCountdown(selectedAuction)}s` : `Ends in ${getAuctionCountdown(selectedAuction)}`}
                      </span>
                    </div>
                    {selectedAuction.status === "upcoming" && (
                      <div className="flex items-center gap-2 rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
                        <span className="text-2xl">🔨</span>
                        <span>Hammer drop in {getAuctionStartCountdown(selectedAuction)}s</span>
                      </div>
                    )}
                    {selectedAuction.status === "ended" && (
                      <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 p-3">
                        <p className="text-[10px] uppercase tracking-[0.25em] text-amber-200">Auction winner</p>
                        <h4 className="mt-2 text-2xl font-semibold text-white">{selectedAuction.current_bidder || "No winner"}</h4>
                        <p className="mt-1 text-sm text-amber-100">Winning bid: {formatMoney(selectedAuction.current_bid)}</p>
                        <p className="mt-1 text-xs text-slate-300">Maximum bid reached: {formatMoney(selectedAuction.current_bid)}</p>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setWatchlist((prev) => prev.includes(selectedAuction.id) ? prev.filter((id) => id !== selectedAuction.id) : [...prev, selectedAuction.id])}
                        className="rounded-lg border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200 hover:bg-amber-500/20"
                      >
                        {watchlist.includes(selectedAuction.id) ? "★ Remove favorite" : "☆ Add favorite"}
                      </button>
                      <button type="button" onClick={deleteAuction} className="rounded-lg border border-rose-500/30 px-3 py-2 text-xs text-rose-200 hover:bg-rose-500/10">
                        Delete listing
                      </button>
                    </div>
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
                        {[1, 2, 3, 5].map((step) => {
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
                          disabled={isSubmitting || auctionEnded || !walletConnected}
                          className="rounded-xl bg-cyan-500 px-5 py-3 font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {auctionEnded ? "Auction ended" : !walletConnected ? "Connect wallet" : isSubmitting ? "Processing..." : "Place Bid"}
                        </button>
                      </div>
                    </div>

                    {message && (
                      <div className={`rounded-2xl border px-4 py-3 text-sm ${
                        message.type === "success"
                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                          : message.type === "info"
                            ? "border-cyan-500/30 bg-cyan-500/10 text-cyan-200"
                            : "border-rose-500/30 bg-rose-500/10 text-rose-200"
                      }`}>
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
                  <p className="text-sm text-slate-500">Waiting for the first wallet-verified bid.</p>
                )}
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-slate-900/80 p-4">
              <h4 className="text-sm uppercase tracking-[0.2em] text-slate-400">System health</h4>
              <div className="mt-4 space-y-3 text-sm text-slate-300">
                {[
                  ["API", "Healthy"],
                  ["Polygon", walletConnected ? "Connected" : "Awaiting wallet"],
                  ["PostgreSQL", "Connected"],
                  ["Redis", "Streaming"],
                ].map(([label, value]) => (
                  <div key={String(label)} className="flex items-center justify-between rounded-xl border border-white/5 bg-slate-800/60 px-3 py-2">
                    <span>{String(label)}</span>
                    <span className="text-emerald-300">{String(value)}</span>
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