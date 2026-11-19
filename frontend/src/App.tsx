import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import {
  Mail,
  Send,
  Clock,
  CheckCircle2,
  AlertCircle,
  Search,
  Plus,
  Upload,
  LogOut,
  ExternalLink,
  RefreshCw,
  Hash,
  Users,
  X,
} from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

interface UserProfile {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string | null;
  slackConnected: boolean;
  slackChannel?: string | null;
}

interface Sender {
  id: string;
  name: string;
  email: string;
  hourlyLimit: number;
}

interface EmailJob {
  id: string;
  recipientEmail: string;
  subject: string;
  body: string;
  status: 'SCHEDULED' | 'SENT' | 'FAILED';
  scheduledAt: string;
  sentAt?: string | null;
  previewUrl?: string | null;
  errorMessage?: string | null;
  sender?: {
    email: string;
    name: string;
  };
}

interface Stats {
  total: number;
  scheduled: number;
  sent: number;
  failed: number;
}

export default function App() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('reachinbox_token'));
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loadingAuth, setLoadingAuth] = useState<boolean>(true);

  const [senders, setSenders] = useState<Sender[]>([]);
  const [emails, setEmails] = useState<EmailJob[]>([]);
  const [stats, setStats] = useState<Stats>({ total: 0, scheduled: 0, sent: 0, failed: 0 });

  const [activeTab, setActiveTab] = useState<'SCHEDULED' | 'SENT' | 'ALL'>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [loadingData, setLoadingData] = useState<boolean>(false);

  // Compose Modal State
  const [isComposeOpen, setIsComposeOpen] = useState<boolean>(false);
  const [selectedSenderId, setSelectedSenderId] = useState<string>('');
  const [subject, setSubject] = useState<string>('');
  const [body, setBody] = useState<string>('');
  const [recipientsText, setRecipientsText] = useState<string>('');
  const [startTime, setStartTime] = useState<string>('');
  const [delayBetweenSeconds, setDelayBetweenSeconds] = useState<number>(3);
  const [hourlyLimit, setHourlyLimit] = useState<number>(20);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [creatingSender, setCreatingSender] = useState<boolean>(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const showToast = (type: 'success' | 'error', text: string) => {
    setToast({ type, text });
    setTimeout(() => setToast(null), 4500);
  };

  // Capture ?token= or ?slack= from OAuth redirect URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get('token');
    const slackStatus = params.get('slack');
    const authError = params.get('error');

    if (urlToken) {
      localStorage.setItem('reachinbox_token', urlToken);
      setToken(urlToken);
      window.history.replaceState({}, document.title, '/');
    } else if (slackStatus === 'connected') {
      showToast('success', 'Slack workspace connected! You will receive live email alerts.');
      window.history.replaceState({}, document.title, '/');
    } else if (slackStatus === 'error' || authError) {
      showToast('error', 'Authentication failed. Please check your OAuth credentials and try again.');
      window.history.replaceState({}, document.title, '/');
    }
  }, []);

  // Fetch User Profile
  useEffect(() => {
    if (!token) {
      setUser(null);
      setLoadingAuth(false);
      return;
    }

    setLoadingAuth(true);
    axios
      .get(`${API_URL}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      .then((res) => {
        setUser(res.data);
      })
      .catch(() => {
        localStorage.removeItem('reachinbox_token');
        setToken(null);
        setUser(null);
      })
      .finally(() => setLoadingAuth(false));
  }, [token]);

  // Fetch Senders, Stats, and Emails
  const fetchDashboardData = useCallback(
    async (silent = false) => {
      if (!token) return;
      if (!silent) setLoadingData(true);
      try {
        const headers = { Authorization: `Bearer ${token}` };
        const [sendersRes, statsRes, emailsRes] = await Promise.all([
          axios.get(`${API_URL}/senders`, { headers }),
          axios.get(`${API_URL}/emails/stats`, { headers }),
          axios.get(`${API_URL}/emails`, {
            headers,
            params: { q: searchQuery, status: activeTab },
          }),
        ]);

        setSenders(sendersRes.data);
        if (sendersRes.data.length > 0 && !selectedSenderId) {
          setSelectedSenderId(sendersRes.data[0].id);
        }
        setStats(statsRes.data);
        setEmails(emailsRes.data);
      } catch (err) {
        console.error('Failed to load dashboard data:', err);
      } finally {
        if (!silent) setLoadingData(false);
      }
    },
    [token, searchQuery, activeTab, selectedSenderId]
  );

  useEffect(() => {
    if (user) {
      fetchDashboardData();
      const interval = setInterval(() => fetchDashboardData(true), 5000);
      return () => clearInterval(interval);
    }
  }, [user, fetchDashboardData]);

  // Parse unique emails from textarea / CSV upload
  const parsedRecipients = Array.from(
    new Set(
      recipientsText
        .split(/[\s,;]+/)
        .map((item) => item.trim().toLowerCase())
        .filter((item) => item.includes('@') && item.includes('.'))
    )
  );

  const handleCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = String(event.target?.result || '');
      const matches = content.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
      if (matches.length === 0) {
        showToast('error', 'No valid email addresses found in the uploaded file.');
        return;
      }
      const combined = Array.from(new Set([...parsedRecipients, ...matches.map((m) => m.toLowerCase())]));
      setRecipientsText(combined.join('\n'));
      showToast('success', `Imported ${matches.length} email(s) from ${file.name}`);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleAddSender = async () => {
    if (!token) return;
    setCreatingSender(true);
    try {
      const res = await axios.post(
        `${API_URL}/senders`,
        { hourlyLimit: 20 },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setSenders((prev) => [...prev, res.data]);
      setSelectedSenderId(res.data.id);
      showToast('success', `Created new Ethereal sender: ${res.data.email}`);
    } catch {
      showToast('error', 'Could not create new Ethereal sender account.');
    } finally {
      setCreatingSender(false);
    }
  };

  const handleScheduleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    if (parsedRecipients.length === 0) {
      showToast('error', 'Please enter or upload at least one valid recipient email.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await axios.post(
        `${API_URL}/emails/schedule`,
        {
          senderId: selectedSenderId,
          subject,
          body,
          recipients: parsedRecipients,
          startTime: startTime ? new Date(startTime).toISOString() : null,
          delayBetweenSeconds,
          hourlyLimit,
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      showToast('success', res.data.message || 'Emails scheduled!');
      setIsComposeOpen(false);
      setSubject('');
      setBody('');
      setRecipientsText('');
      setStartTime('');
      fetchDashboardData();
    } catch (err: any) {
      showToast('error', err.response?.data?.error || 'Failed to schedule emails.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('reachinbox_token');
    setToken(null);
    setUser(null);
  };

  if (loadingAuth) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
        <RefreshCw className="w-8 h-8 animate-spin text-emerald-400" />
      </div>
    );
  }

  // LOGIN SCREEN
  if (!user) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl text-center">
          <div className="w-14 h-14 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl flex items-center justify-center mx-auto mb-5">
            <Mail className="w-7 h-7 text-emerald-400" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight mb-2">ReachInbox Scheduler</h1>
          <p className="text-slate-400 text-sm mb-8">
            Production-grade distributed email campaign scheduler powered by BullMQ, Redis, PostgreSQL & Elasticsearch.
          </p>

          <a
            href={`${API_URL}/auth/google`}
            className="w-full flex items-center justify-center gap-3 bg-white hover:bg-slate-100 text-slate-900 font-semibold py-3 px-4 rounded-xl transition shadow-lg"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
              />
              <path
                fill="#34A853"
                d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
              />
              <path
                fill="#FBBC05"
                d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
              />
              <path
                fill="#EA4335"
                d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
              />
            </svg>
            Sign in with Google
          </a>
        </div>
      </div>
    );
  }

  // MAIN DASHBOARD
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Toast Banner */}
      {toast && (
        <div
          className={`fixed top-5 right-5 z-50 px-4 py-3 rounded-xl shadow-xl border text-sm font-medium flex items-center gap-2 ${
            toast.type === 'success'
              ? 'bg-emerald-950/90 border-emerald-500/40 text-emerald-200'
              : 'bg-rose-950/90 border-rose-500/40 text-rose-200'
          }`}
        >
          {toast.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {toast.text}
        </div>
      )}

      {/* Top Navigation */}
      <header className="border-b border-slate-800 bg-slate-900/70 backdrop-blur sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
              <Mail className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <span className="font-bold text-lg tracking-tight">ReachInbox</span>
              <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
                Email Scheduler
              </span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {/* Slack Connect Status */}
            {user.slackConnected ? (
              <span className="hidden sm:inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-300 border border-emerald-500/30">
                <Hash className="w-3.5 h-3.5" />
                Slack Connected ({user.slackChannel || '#general'})
              </span>
            ) : (
              <button
                onClick={async () => {
                  const url = window.prompt('Paste your Slack Incoming Webhook URL (https://hooks.slack.com/services/...):');
                  if (!url) return;
                  try {
                    await axios.post(
                      `${API_URL}/auth/slack/webhook`,
                      { webhookUrl: url.trim(), channelName: '#all-new-workspace' },
                      { headers: { Authorization: `Bearer ${token}` } }
                    );
                    setUser((prev) => (prev ? { ...prev, slackConnected: true, slackChannel: '#all-new-workspace' } : prev));
                    showToast('success', 'Slack webhook connected to #all-new-workspace!');
                  } catch {
                    showToast('error', 'Invalid Slack Webhook URL.');
                  }
                }}
                className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-purple-600/20 hover:bg-purple-600/30 text-purple-200 border border-purple-500/40 transition"
              >
                <Hash className="w-3.5 h-3.5" />
                Connect Slack Alerts
              </button>
            )}

            <div className="flex items-center gap-2.5 pl-3 border-l border-slate-800">
              {user.avatarUrl ? (
                <img src={user.avatarUrl} alt={user.name} className="w-8 h-8 rounded-full" />
              ) : (
                <div className="w-8 h-8 rounded-full bg-emerald-600 flex items-center justify-center text-xs font-bold">
                  {user.name[0]?.toUpperCase()}
                </div>
              )}
              <div className="hidden md:block text-left">
                <p className="text-xs font-semibold leading-none">{user.name}</p>
                <p className="text-[11px] text-slate-400 mt-0.5">{user.email}</p>
              </div>
              <button
                onClick={handleLogout}
                title="Logout"
                className="p-2 text-slate-400 hover:text-rose-400 rounded-lg hover:bg-slate-800 transition"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        {/* Stats + Primary Action Row */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 flex-1">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="text-xs text-slate-400">Total Emails</p>
              <p className="text-2xl font-bold mt-1">{stats.total}</p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="text-xs text-amber-400 flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" /> Scheduled
              </p>
              <p className="text-2xl font-bold mt-1 text-amber-300">{stats.scheduled}</p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="text-xs text-emerald-400 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> Sent
              </p>
              <p className="text-2xl font-bold mt-1 text-emerald-300">{stats.sent}</p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="text-xs text-rose-400 flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5" /> Failed
              </p>
              <p className="text-2xl font-bold mt-1 text-rose-300">{stats.failed}</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleAddSender}
              disabled={creatingSender}
              className="inline-flex items-center gap-2 px-4 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sm font-medium transition disabled:opacity-50"
            >
              <Users className="w-4 h-4 text-emerald-400" />
              {creatingSender ? 'Creating...' : '+ New Sender'}
            </button>
            <button
              onClick={() => setIsComposeOpen(true)}
              className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-sm transition shadow-lg shadow-emerald-500/20"
            >
              <Plus className="w-4 h-4" />
              Compose New Email
            </button>
          </div>
        </div>

        {/* Filter Tabs + Elasticsearch Search Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900 border border-slate-800 p-4 rounded-2xl">
          <div className="flex items-center gap-2">
            {(['ALL', 'SCHEDULED', 'SENT'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 rounded-xl text-xs font-semibold transition ${
                  activeTab === tab
                    ? 'bg-emerald-500 text-slate-950'
                    : 'bg-slate-800/70 text-slate-300 hover:bg-slate-800'
                }`}
              >
                {tab === 'ALL' ? 'All Emails' : tab === 'SCHEDULED' ? 'Scheduled Emails' : 'Sent Emails'}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 flex-1 max-w-md">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search recipient, subject, or body (Elasticsearch)..."
                className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-4 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <button
              onClick={() => fetchDashboardData()}
              title="Refresh"
              className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
            >
              <RefreshCw className={`w-4 h-4 ${loadingData ? 'animate-spin text-emerald-400' : ''}`} />
            </button>
          </div>
        </div>

        {/* Email Jobs Table */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
          {emails.length === 0 ? (
            <div className="p-14 text-center">
              <Mail className="w-10 h-10 text-slate-600 mx-auto mb-3" />
              <h3 className="text-base font-semibold text-slate-300">No emails found</h3>
              <p className="text-xs text-slate-500 mt-1">
                Click "Compose New Email" to schedule your first single or bulk CSV campaign.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-[11px] uppercase tracking-wider text-slate-400 bg-slate-950/40">
                    <th className="py-3.5 px-5">Recipient</th>
                    <th className="py-3.5 px-5">Subject</th>
                    <th className="py-3.5 px-5">Sender</th>
                    <th className="py-3.5 px-5">Scheduled / Sent Time</th>
                    <th className="py-3.5 px-5">Status</th>
                    <th className="py-3.5 px-5 text-right">Preview</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70 text-sm">
                  {emails.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-800/30 transition">
                      <td className="py-3.5 px-5 font-medium text-slate-200">{item.recipientEmail}</td>
                      <td className="py-3.5 px-5 text-slate-300 max-w-xs truncate">{item.subject}</td>
                      <td className="py-3.5 px-5 text-xs text-slate-400">{item.sender?.email || 'Default'}</td>
                      <td className="py-3.5 px-5 text-xs text-slate-400">
                        {item.sentAt
                          ? new Date(item.sentAt).toLocaleString()
                          : new Date(item.scheduledAt).toLocaleString()}
                      </td>
                      <td className="py-3.5 px-5">
                        {item.status === 'SENT' && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                            <CheckCircle2 className="w-3 h-3" /> Sent
                          </span>
                        )}
                        {item.status === 'SCHEDULED' && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-500/10 text-amber-300 border border-amber-500/30">
                            <Clock className="w-3 h-3" /> Scheduled
                          </span>
                        )}
                        {item.status === 'FAILED' && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-rose-500/10 text-rose-400 border border-rose-500/30">
                            <AlertCircle className="w-3 h-3" /> Failed
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-5 text-right">
                        {item.previewUrl ? (
                          <a
                            href={item.previewUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400 hover:text-emerald-300"
                          >
                            Ethereal <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        ) : (
                          <span className="text-xs text-slate-600">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      {/* Compose New Email Modal */}
      {isComposeOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <h2 className="text-lg font-bold flex items-center gap-2">
                <Send className="w-5 h-5 text-emerald-400" />
                Schedule Email Campaign
              </h2>
              <button
                onClick={() => setIsComposeOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleScheduleSubmit} className="space-y-4 mt-5">
              {/* Sender Select */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">From Sender (Ethereal SMTP)</label>
                <select
                  value={selectedSenderId}
                  onChange={(e) => setSelectedSenderId(e.target.value)}
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-emerald-500"
                >
                  {senders.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} — {s.email} (Limit: {s.hourlyLimit}/hr)
                    </option>
                  ))}
                </select>
              </div>

              {/* Recipients + CSV Upload */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-slate-300">
                    Recipients ({parsedRecipients.length} valid email{parsedRecipients.length === 1 ? '' : 's'} detected)
                  </label>
                  <label className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400 hover:text-emerald-300 cursor-pointer">
                    <Upload className="w-3.5 h-3.5" />
                    Upload CSV / TXT
                    <input type="file" accept=".csv,.txt" onChange={handleCsvUpload} className="hidden" />
                  </label>
                </div>
                <textarea
                  rows={3}
                  value={recipientsText}
                  onChange={(e) => setRecipientsText(e.target.value)}
                  placeholder="Enter emails separated by commas or new lines, or upload a CSV file..."
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                />
              </div>

              {/* Subject */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">Subject</label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Quick question about your outbound workflow"
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                />
              </div>

              {/* Body */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">Email Body</label>
                <textarea
                  rows={4}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Hi there,&#10;&#10;Writing to share how our scheduled outreach works..."
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                />
              </div>

              {/* Scheduling & Rate Limit Controls */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Start Time (Optional)
                  </label>
                  <input
                    type="datetime-local"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">Leave blank to send immediately</p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Delay Between Emails (sec)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={3600}
                    value={delayBetweenSeconds}
                    onChange={(e) => setDelayBetweenSeconds(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Hourly Rate Limit / Sender
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={1000}
                    value={hourlyLimit}
                    onChange={(e) => setHourlyLimit(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              {/* Submit Buttons */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsComposeOpen(false)}
                  className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-sm font-medium text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-sm transition disabled:opacity-50"
                >
                  <Send className="w-4 h-4" />
                  {submitting ? 'Scheduling...' : `Schedule ${parsedRecipients.length || ''} Email(s)`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}