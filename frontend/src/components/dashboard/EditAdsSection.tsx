import { useEffect, useMemo, useState } from 'react';
import {
  Pencil,
  Loader2,
  Plus,
  Trash2,
  Save,
  Eye,
  ChevronDown,
} from 'lucide-react';
import { googleAdsApi } from '../../services/api';
import type { GoogleAdsCampaign, GoogleAdsCampaignAd } from '../../types/connect';
import {
  formatCurrencyPrecise,
  formatNumber,
  formatPercent,
} from '../../utils/helpers';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';

const MAX_HEADLINES = 15;
const MAX_DESCRIPTIONS = 4;
const HEADLINE_LIMIT = 30;
const DESCRIPTION_LIMIT = 90;
const PATH_LIMIT = 15;

function formatGoogleAdsCustomerId(id: string): string {
  const bare = id.replace(/\D/g, '');
  if (bare.length !== 10) return id;
  return `${bare.slice(0, 3)}-${bare.slice(3, 6)}-${bare.slice(6)}`;
}

function CharCount({ value, max }: { value: string; max: number }) {
  const over = value.length > max;
  return (
    <span className={over ? 'text-red-400 text-[10px]' : 'text-muted text-[10px]'}>
      {value.length}/{max}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-navy/50 px-2.5 py-1.5">
      <p className="text-muted text-[9px] uppercase tracking-wide">{label}</p>
      <p className="text-white text-xs font-semibold">{value}</p>
    </div>
  );
}

interface EditAdsSectionProps {
  auditId: string;
  googleAdsCustomerId?: string;
  dataWindowDays?: number;
  onPosted?: () => void;
}

export function EditAdsSection({
  auditId,
  googleAdsCustomerId,
  dataWindowDays = 30,
  onPosted,
}: EditAdsSectionProps) {
  const [campaigns, setCampaigns] = useState<GoogleAdsCampaign[]>([]);
  const [currency, setCurrency] = useState('AUD');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [campaignId, setCampaignId] = useState('');
  const [adResourceName, setAdResourceName] = useState('');
  const [headlines, setHeadlines] = useState<string[]>(['', '', '']);
  const [descriptions, setDescriptions] = useState<string[]>(['', '']);
  const [path1, setPath1] = useState('');
  const [path2, setPath2] = useState('');
  const [finalUrl, setFinalUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const customerId = googleAdsCustomerId
    ? formatGoogleAdsCustomerId(googleAdsCustomerId)
    : undefined;

  useEffect(() => {
    if (!customerId) return;
    setLoading(true);
    setError(null);
    void googleAdsApi
      .campaigns(customerId, dataWindowDays)
      .then(({ data }) => {
        setCampaigns(data.campaigns ?? []);
        setCurrency(data.account?.currency || data.performance?.currency || 'AUD');
        const firstWithAds = (data.campaigns ?? []).find((c) => (c.ads?.length ?? 0) > 0);
        if (firstWithAds) {
          setCampaignId(firstWithAds.id);
          const firstAd = firstWithAds.ads[0];
          if (firstAd) applyAd(firstAd);
        }
      })
      .catch(() => {
        setError('Could not load campaigns for editing.');
        setCampaigns([]);
      })
      .finally(() => setLoading(false));
  }, [customerId, dataWindowDays]);

  const selectedCampaign = useMemo(
    () => campaigns.find((c) => c.id === campaignId) ?? null,
    [campaigns, campaignId]
  );

  const selectedAd = useMemo(
    () => selectedCampaign?.ads.find((a) => a.resourceName === adResourceName) ?? null,
    [selectedCampaign, adResourceName]
  );

  function applyAd(ad: GoogleAdsCampaignAd) {
    setAdResourceName(ad.resourceName);
    setHeadlines(
      ad.headlines.length >= 3
        ? [...ad.headlines].slice(0, MAX_HEADLINES)
        : [...ad.headlines, '', '', ''].slice(0, Math.max(3, ad.headlines.length))
    );
    setDescriptions(
      ad.descriptions.length >= 2
        ? [...ad.descriptions].slice(0, MAX_DESCRIPTIONS)
        : [...ad.descriptions, '', ''].slice(0, Math.max(2, ad.descriptions.length))
    );
    setPath1(ad.displayPath1 ?? '');
    setPath2(ad.displayPath2 ?? '');
    setFinalUrl(ad.finalUrls?.[0] ?? '');
    setSaveMessage(null);
  }

  const onCampaignChange = (id: string) => {
    setCampaignId(id);
    const campaign = campaigns.find((c) => c.id === id);
    const ad = campaign?.ads?.[0];
    if (ad) applyAd(ad);
    else {
      setAdResourceName('');
      setHeadlines(['', '', '']);
      setDescriptions(['', '']);
      setPath1('');
      setPath2('');
      setFinalUrl('');
    }
  };

  const validationError = useMemo(() => {
    const hs = headlines.map((h) => h.trim()).filter(Boolean);
    const ds = descriptions.map((d) => d.trim()).filter(Boolean);
    if (hs.length < 3) return 'Google Ads requires at least 3 headlines.';
    if (ds.length < 2) return 'Google Ads requires at least 2 descriptions.';
    if (hs.some((h) => h.length > HEADLINE_LIMIT)) return `Headlines must be ≤ ${HEADLINE_LIMIT} characters.`;
    if (ds.some((d) => d.length > DESCRIPTION_LIMIT)) {
      return `Descriptions must be ≤ ${DESCRIPTION_LIMIT} characters.`;
    }
    if (!finalUrl.trim()) return 'Final URL is required.';
    if (path1.length > PATH_LIMIT || path2.length > PATH_LIMIT) {
      return `Display paths must be ≤ ${PATH_LIMIT} characters.`;
    }
    return null;
  }, [headlines, descriptions, finalUrl, path1, path2]);

  const previewHost = useMemo(() => {
    try {
      const u = finalUrl.startsWith('http') ? finalUrl : `https://${finalUrl}`;
      return new URL(u).hostname.replace(/^www\./, '');
    } catch {
      return 'example.com';
    }
  }, [finalUrl]);

  const handleSave = async () => {
    if (!customerId || !selectedCampaign || !selectedAd || validationError) return;
    setSaving(true);
    setSaveMessage(null);
    setError(null);
    try {
      const { data } = await googleAdsApi.updateAd({
        auditRunId: auditId,
        googleAdsCustomerId: customerId,
        campaignId: selectedCampaign.id,
        campaignName: selectedCampaign.name,
        campaignResourceName: selectedCampaign.resourceName,
        adGroupName: selectedAd.adGroupName,
        adGroupAdResourceName: selectedAd.resourceName,
        originalAd: {
          headlines: selectedAd.headlines,
          descriptions: selectedAd.descriptions,
          finalUrls: selectedAd.finalUrls,
          displayPath1: selectedAd.displayPath1,
          displayPath2: selectedAd.displayPath2,
        },
        content: {
          headlines: headlines.map((h) => h.trim()).filter(Boolean),
          descriptions: descriptions.map((d) => d.trim()).filter(Boolean),
          displayPaths: {
            path1: path1.trim() || undefined,
            path2: path2.trim() || undefined,
          },
          finalUrl: finalUrl.trim(),
        },
      });
      setSaveMessage(
        data.message ||
          `Saved as ${data.status}. Existing ad updated in Google Ads.`
      );
      try {
        const refreshed = await googleAdsApi.campaigns(customerId, dataWindowDays);
        setCampaigns(refreshed.data.campaigns ?? []);
        const campaign = (refreshed.data.campaigns ?? []).find((c) => c.id === selectedCampaign.id);
        const ad =
          campaign?.ads.find((a) => a.resourceName === selectedAd.resourceName) ??
          campaign?.ads.find((a) => a.resourceName === data.resourceName) ??
          campaign?.ads?.[0];
        if (ad) applyAd(ad);
      } catch {
        /* keep edited form values if refresh fails */
      }
      onPosted?.();
    } catch (err) {
      const message =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { message?: string; error?: string } } }).response?.data
              ?.message ||
            (err as { response?: { data?: { error?: string } } }).response?.data?.error
          : undefined;
      setError(message || 'Could not post edited ad to Google Ads.');
    } finally {
      setSaving(false);
    }
  };

  if (!customerId) return null;

  return (
    <section id="edit-ads" className="scroll-mt-24">
      <div className="mb-4">
        <h2 className="text-white font-bold text-xl flex items-center gap-2">
          <Pencil size={20} className="text-orange" />
          Edit Ads
        </h2>
        <p className="text-muted text-sm mt-1">
          Edit an existing Responsive Search Ad in place — headlines, descriptions, paths, and
          final URL. Saving updates that ad in Google Ads (does not create a duplicate) and
          records the change in Posted Ads History.
        </p>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-muted text-sm py-6">
          <Loader2 size={16} className="animate-spin" />
          Loading ads from Google Ads…
        </div>
      )}

      {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
      {saveMessage && <p className="text-teal text-sm mb-3">{saveMessage}</p>}

      {!loading && campaigns.length > 0 && (
        <div className="grid lg:grid-cols-[1.2fr_0.8fr] gap-4">
          <div className="bg-panel border border-border rounded-xl p-4 space-y-4">
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className="text-muted text-[11px] uppercase tracking-wider">Campaign</span>
                <div className="relative">
                  <select
                    value={campaignId}
                    onChange={(e) => onCampaignChange(e.target.value)}
                    className="w-full appearance-none bg-navy border border-border rounded-lg px-3 py-2 text-sm text-white pr-8"
                  >
                    {campaigns.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.status})
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    size={14}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
                  />
                </div>
              </label>
              <label className="block space-y-1">
                <span className="text-muted text-[11px] uppercase tracking-wider">Ad</span>
                <div className="relative">
                  <select
                    value={adResourceName}
                    onChange={(e) => {
                      const ad = selectedCampaign?.ads.find((a) => a.resourceName === e.target.value);
                      if (ad) applyAd(ad);
                    }}
                    className="w-full appearance-none bg-navy border border-border rounded-lg px-3 py-2 text-sm text-white pr-8"
                  >
                    {(selectedCampaign?.ads ?? []).map((ad) => (
                      <option key={ad.resourceName} value={ad.resourceName}>
                        {ad.adGroupName} · {ad.headlines[0] || ad.id} ({ad.status})
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    size={14}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
                  />
                </div>
              </label>
            </div>

            {selectedAd && (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                <Stat label="Status" value={selectedAd.status} />
                <Stat label="Clicks" value={formatNumber(selectedAd.clicks)} />
                <Stat label="Impr." value={formatNumber(selectedAd.impressions)} />
                <Stat label="CTR" value={formatPercent(selectedAd.ctr)} />
                <Stat label="Avg. CPC" value={formatCurrencyPrecise(selectedAd.avgCpc, currency)} />
                <Stat label="Conv." value={selectedAd.conversions.toFixed(2)} />
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-orange text-[11px] font-semibold uppercase tracking-wider">
                  Headlines ({headlines.filter((h) => h.trim()).length}/{MAX_HEADLINES})
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={headlines.length >= MAX_HEADLINES}
                  onClick={() => setHeadlines((h) => [...h, ''])}
                >
                  <Plus size={14} /> Add
                </Button>
              </div>
              {headlines.map((value, i) => (
                <div key={`h-${i}`} className="flex gap-2 items-center">
                  <input
                    value={value}
                    maxLength={HEADLINE_LIMIT + 5}
                    onChange={(e) => {
                      const next = [...headlines];
                      next[i] = e.target.value;
                      setHeadlines(next);
                    }}
                    placeholder={`Headline ${i + 1}`}
                    className="flex-1 min-w-0 bg-navy border border-border rounded-lg px-3 py-2 text-xs text-white"
                  />
                  <CharCount value={value} max={HEADLINE_LIMIT} />
                  <button
                    type="button"
                    disabled={headlines.length <= 3}
                    onClick={() => setHeadlines((h) => h.filter((_, j) => j !== i))}
                    className="p-2 text-muted hover:text-red-300 disabled:opacity-30"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-orange text-[11px] font-semibold uppercase tracking-wider">
                  Descriptions ({descriptions.filter((d) => d.trim()).length}/{MAX_DESCRIPTIONS})
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={descriptions.length >= MAX_DESCRIPTIONS}
                  onClick={() => setDescriptions((d) => [...d, ''])}
                >
                  <Plus size={14} /> Add
                </Button>
              </div>
              {descriptions.map((value, i) => (
                <div key={`d-${i}`} className="flex gap-2 items-start">
                  <textarea
                    value={value}
                    maxLength={DESCRIPTION_LIMIT + 10}
                    rows={2}
                    onChange={(e) => {
                      const next = [...descriptions];
                      next[i] = e.target.value;
                      setDescriptions(next);
                    }}
                    placeholder={`Description ${i + 1}`}
                    className="flex-1 min-w-0 bg-navy border border-border rounded-lg px-3 py-2 text-xs text-white resize-y"
                  />
                  <div className="flex flex-col items-end gap-1">
                    <CharCount value={value} max={DESCRIPTION_LIMIT} />
                    <button
                      type="button"
                      disabled={descriptions.length <= 2}
                      onClick={() => setDescriptions((d) => d.filter((_, j) => j !== i))}
                      className="p-2 text-muted hover:text-red-300 disabled:opacity-30"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className="text-muted text-[11px]">Path 1</span>
                <input
                  value={path1}
                  maxLength={PATH_LIMIT + 5}
                  onChange={(e) => setPath1(e.target.value)}
                  className="w-full bg-navy border border-border rounded-lg px-3 py-2 text-xs text-white"
                />
                <CharCount value={path1} max={PATH_LIMIT} />
              </label>
              <label className="block space-y-1">
                <span className="text-muted text-[11px]">Path 2</span>
                <input
                  value={path2}
                  maxLength={PATH_LIMIT + 5}
                  onChange={(e) => setPath2(e.target.value)}
                  className="w-full bg-navy border border-border rounded-lg px-3 py-2 text-xs text-white"
                />
                <CharCount value={path2} max={PATH_LIMIT} />
              </label>
            </div>

            <label className="block space-y-1">
              <span className="text-muted text-[11px]">Final URL</span>
              <input
                value={finalUrl}
                onChange={(e) => setFinalUrl(e.target.value)}
                placeholder="https://"
                className="w-full bg-navy border border-border rounded-lg px-3 py-2 text-xs text-white"
              />
            </label>

            {validationError && <p className="text-amber-400 text-xs">{validationError}</p>}

            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => void handleSave()}
                disabled={saving || !!validationError || !selectedAd}
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Save to Google Ads
              </Button>
              {selectedAd?.adStrength && (
                <Badge variant="muted">Ad strength: {selectedAd.adStrength}</Badge>
              )}
            </div>
          </div>

          <div className="bg-panel border border-border rounded-xl p-4 space-y-3 h-fit sticky top-24">
            <p className="text-muted text-[11px] font-semibold uppercase tracking-wider flex items-center gap-1">
              <Eye size={12} /> Google Ads preview
            </p>
            <div className="rounded-lg bg-white text-slate-900 p-3 space-y-1">
              <p className="text-[11px] text-green-700 truncate">
                {previewHost}
                {path1 ? ` › ${path1}` : ''}
                {path2 ? ` › ${path2}` : ''}
              </p>
              <p className="text-blue-700 text-sm font-medium leading-snug">
                {headlines.filter((h) => h.trim()).slice(0, 3).join(' | ') || 'Headline'}
              </p>
              <p className="text-slate-600 text-xs leading-relaxed">
                {descriptions.find((d) => d.trim()) || 'Description'}
              </p>
            </div>
            <p className="text-muted text-[10px] leading-relaxed">
              Google Ads serves combinations of your headlines and descriptions. Character limits
              match the Google Ads editor (30 / 90 / 15). Saving updates the selected ad rather
              than creating a new one.
            </p>
          </div>
        </div>
      )}

      {!loading && !campaigns.length && !error && (
        <div className="bg-panel border border-border rounded-xl p-6 text-center text-muted text-sm">
          No campaigns with ads found for this account.
        </div>
      )}
    </section>
  );
}
