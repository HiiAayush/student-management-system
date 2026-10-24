import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GraduationCap, LayoutDashboard, Users, Search, Plus, Pencil, Trash2, X, RefreshCw, Menu, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, ChevronsUpDown, CheckCircle2, AlertCircle, Mail, Phone, Building2, Layers, UserPlus, TriangleAlert } from 'lucide-react';

const API = (import.meta.env.VITE_API_URL || 'https://student-management-system-cn4s.onrender.com').replace(/\/+$/, '');
const PAGE_SIZE = 8;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const emptyForm = { studentId: '', name: '', email: '', department: '', semester: '1', contact: '' };

async function api(path, options) {
  let response;
  try { response = await fetch(`${API}/api/students${path}`, options); }
  catch { throw new Error('Cannot reach the server. It may be waking up, so please try again in a moment.'); }
  let body = null;
  try { body = await response.json(); } catch { /* non-JSON response */ }
  if (!response.ok) throw new Error(body?.message || `Request failed (${response.status})`);
  return body || {};
}
const initials = name => (name || '?').trim().split(/\s+/).map(n => n[0]).slice(0, 2).join('').toUpperCase();
const fmtDate = d => d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const tally = (list, fn) => Object.entries(list.reduce((m, s) => { const k = fn(s); m[k] = (m[k] || 0) + 1; return m; }, {})).sort((a, b) => b[1] - a[1]);
function validate(f) {
  const e = {};
  if (!f.studentId.trim()) e.studentId = 'Student ID is required'; else if (f.studentId.trim().length > 30) e.studentId = 'Maximum 30 characters';
  if (!f.name.trim()) e.name = 'Full name is required'; else if (f.name.trim().length > 100) e.name = 'Maximum 100 characters';
  if (!f.email.trim()) e.email = 'Email is required'; else if (!EMAIL_RE.test(f.email.trim())) e.email = 'Enter a valid email address';
  if (!f.department.trim()) e.department = 'Department is required'; else if (f.department.trim().length > 100) e.department = 'Maximum 100 characters';
  if (f.contact.trim().length > 20) e.contact = 'Maximum 20 characters';
  return e;
}

function Field({ id, label, error, hint, full, children }) {
  return <div className={`field${full ? ' full' : ''}${error ? ' invalid' : ''}`}>
    <label htmlFor={id}>{label}</label>{children}
    {error ? <p className="field-msg" id={`${id}-msg`} role="alert">{error}</p> : hint ? <p className="field-hint">{hint}</p> : null}
  </div>;
}
function SortTh({ label, k, sort, onSort }) {
  const active = sort.key === k;
  return <th aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
    <button type="button" className="sort-btn" onClick={() => onSort(k)}>{label}{active ? (sort.dir === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />) : <ChevronsUpDown size={14} />}</button>
  </th>;
}
function Bars({ data, total }) {
  if (!data.length) return <p className="muted">No data yet.</p>;
  const max = data[0][1];
  return <ul className="bars">{data.map(([label, n]) => <li key={label}><span className="bar-label">{label}</span><span className="bar-track"><span className="bar-fill" style={{ width: `${(n / max) * 100}%` }} /></span><span className="bar-num">{n}<small>{Math.round((n / total) * 100)}%</small></span></li>)}</ul>;
}

export default function App() {
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState('');
  const [view, setView] = useState('dashboard');
  const [navOpen, setNavOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [dept, setDept] = useState('all');
  const [sem, setSem] = useState('all');
  const [sort, setSort] = useState({ key: 'createdAt', dir: 'desc' });
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const toastTimer = useRef();

  const notify = useCallback((type, message) => { clearTimeout(toastTimer.current); setToast({ type, message }); toastTimer.current = setTimeout(() => setToast(null), 4000); }, []);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    const t = setTimeout(() => setSlow(true), 4000);
    try { const r = await api(''); setStudents(r.data || []); }
    catch (e) { setError(e.message); }
    finally { clearTimeout(t); setSlow(false); setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [query, dept, sem]);
  useEffect(() => {
    const h = e => { if (e.key === 'Escape') { setModal(false); setConfirm(null); setNavOpen(false); } };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, []);

  const departments = useMemo(() => [...new Set(students.map(s => s.department))].sort((a, b) => a.localeCompare(b)), [students]);
  const semesters = useMemo(() => [...new Set(students.map(s => s.semester))].sort((a, b) => a - b), [students]);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase(), dir = sort.dir === 'asc' ? 1 : -1;
    return students.filter(s => (dept === 'all' || s.department === dept) && (sem === 'all' || String(s.semester) === sem) &&
      (!q || [s.studentId, s.name, s.email, s.department].some(v => String(v || '').toLowerCase().includes(q))))
      .sort((a, b) => {
        const x = a[sort.key], y = b[sort.key];
        if (sort.key === 'semester') return (x - y) * dir;
        if (sort.key === 'createdAt') return (new Date(x) - new Date(y)) * dir;
        return String(x ?? '').localeCompare(String(y ?? ''), undefined, { numeric: true, sensitivity: 'base' }) * dir;
      });
  }, [students, query, dept, sem, sort]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const pageRows = rows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const stats = useMemo(() => {
    const week = Date.now() - 7 * 864e5;
    return { total: students.length, depts: departments.length, sems: semesters.length, recent: students.filter(s => new Date(s.createdAt).getTime() >= week).length };
  }, [students, departments, semesters]);
  const byDept = useMemo(() => tally(students, s => s.department).slice(0, 6), [students]);
  const bySem = useMemo(() => tally(students, s => `Semester ${s.semester}`).sort((a, b) => parseInt(a[0].slice(9)) - parseInt(b[0].slice(9))), [students]);
  const recent = useMemo(() => [...students].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 5), [students]);
  const status = error ? 'offline' : loading && !students.length ? 'checking' : 'online';
  const filtersOn = query || dept !== 'all' || sem !== 'all';

  const go = v => { setView(v); setNavOpen(false); };
  const onSort = key => setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' });
  const onSearch = v => { setQuery(v); if (v && view !== 'students') setView('students'); };
  const clearFilters = () => { setQuery(''); setDept('all'); setSem('all'); };
  const openAdd = () => { setEditing(null); setForm(emptyForm); setErrors({}); setModal(true); };
  const openEdit = s => { setEditing(s._id); setForm({ studentId: s.studentId, name: s.name, email: s.email, department: s.department, semester: String(s.semester), contact: s.contact || '' }); setErrors({}); setModal(true); };
  const setField = (k, v) => { setForm(f => ({ ...f, [k]: v })); setErrors(e => ({ ...e, [k]: undefined, form: undefined })); };
  const submit = async e => {
    e.preventDefault();
    const errs = validate(form); setErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    try {
      const r = await api(editing ? `/${editing}` : '', { method: editing ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, studentId: form.studentId.trim(), name: form.name.trim(), email: form.email.trim(), department: form.department.trim(), contact: form.contact.trim(), semester: Number(form.semester) }) });
      notify('success', r.message || 'Saved successfully'); setModal(false); setEditing(null); await load();
    } catch (err) { setErrors({ form: err.message }); }
    finally { setSaving(false); }
  };
  const remove = async () => {
    setDeleting(true);
    try { const r = await api(`/${confirm._id}`, { method: 'DELETE' }); notify('success', r.message || 'Student deleted'); setConfirm(null); await load(); }
    catch (err) { notify('error', err.message); setConfirm(null); }
    finally { setDeleting(false); }
  };
  const fieldProps = k => ({ id: `f-${k}`, 'aria-invalid': !!errors[k], 'aria-describedby': errors[k] ? `f-${k}-msg` : undefined });

  const Skeleton = () => Array.from({ length: 5 }, (_, i) => <tr key={i} className="skeleton-row"><td colSpan="7"><span className="skeleton" /></td></tr>);

  return <div className="app-shell">
    <a className="skip-link" href="#main">Skip to content</a>
    {navOpen && <div className="scrim" onClick={() => setNavOpen(false)} />}
    <aside className={`sidebar${navOpen ? ' open' : ''}`} aria-label="Primary">
      <div className="brand"><div className="brand-icon"><GraduationCap size={22} /></div><div><strong>StudentHub</strong><span>Management portal</span></div></div>
      <nav>
        <div className="side-label">Workspace</div>
        <button className={`nav-item${view === 'dashboard' ? ' active' : ''}`} aria-current={view === 'dashboard' ? 'page' : undefined} onClick={() => go('dashboard')}><LayoutDashboard size={18} /> Dashboard</button>
        <button className={`nav-item${view === 'students' ? ' active' : ''}`} aria-current={view === 'students' ? 'page' : undefined} onClick={() => go('students')}><Users size={18} /> Students <span className="nav-count">{students.length}</span></button>
      </nav>
      <div className="sidebar-bottom"><span className={`status-dot ${status}`} /><div><strong>API connection</strong><span>{status === 'checking' ? 'Checking…' : status === 'online' ? 'Connected' : 'Unavailable'}</span></div></div>
    </aside>

    <div className="main">
      <header className="topbar">
        <button className="icon-btn menu-btn" onClick={() => setNavOpen(true)} aria-label="Open navigation"><Menu size={20} /></button>
        <div className="search-box"><Search size={18} /><input aria-label="Search students" placeholder="Search by name, ID, email, department…" value={query} onChange={e => onSearch(e.target.value)} />{query && <button onClick={() => setQuery('')} aria-label="Clear search"><X size={16} /></button>}</div>
        <button className="primary-btn top-add" onClick={openAdd}><Plus size={18} /><span>Add student</span></button>
        <div className="profile"><div className="avatar" aria-hidden="true">AD</div><div className="profile-text"><strong>Admin</strong><span>StudentHub</span></div></div>
      </header>

      <main id="main" className="content">
        {toast && <div className={`toast ${toast.type}`} role="status">{toast.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}<span>{toast.message}</span><button onClick={() => setToast(null)} aria-label="Dismiss"><X size={16} /></button></div>}
        <div className="page-heading">
          <div><div className="eyebrow">{view === 'dashboard' ? 'Overview' : 'Student directory'}</div><h1>{view === 'dashboard' ? 'Dashboard' : 'Students'}</h1><p>{view === 'dashboard' ? 'A live snapshot of your student records.' : 'Search, filter, sort and manage every student record.'}</p></div>
          <button className="icon-btn refresh" title="Refresh data" aria-label="Refresh data" onClick={load} disabled={loading}><RefreshCw size={18} className={loading ? 'spin' : ''} /></button>
        </div>
        {slow && loading && <div className="info-banner" role="status"><RefreshCw size={16} className="spin" /> The server is waking up. This can take up to a minute on the first request.</div>}
        {error && <div className="error-banner" role="alert"><AlertCircle size={18} /><span>{error}</span><button onClick={load}>Retry</button></div>}

        <section className="stats-grid" aria-label="Summary">
          {[['Total students', stats.total, 'All records', Users, 'indigo'], ['Departments', stats.depts, 'Distinct departments', Building2, 'sky'], ['Semesters in use', stats.sems, 'Distinct semesters', Layers, 'emerald'], ['Added this week', stats.recent, 'Last 7 days', UserPlus, 'amber']].map(([label, n, sub, Icon, tone]) =>
            <div className="stat-card" key={label}><div className={`stat-icon ${tone}`}><Icon size={20} /></div><div><span>{label}</span><strong>{loading && !students.length ? '–' : n}</strong><small>{sub}</small></div></div>)}
        </section>

        {view === 'dashboard' && <div className="dash-grid">
          <section className="panel"><div className="panel-header"><div><h2>Students by department</h2><p>Top departments by headcount</p></div></div><div className="panel-body"><Bars data={byDept} total={stats.total} /></div></section>
          <section className="panel"><div className="panel-header"><div><h2>Students by semester</h2><p>Distribution across semesters</p></div></div><div className="panel-body"><Bars data={bySem} total={stats.total} /></div></section>
          <section className="panel wide"><div className="panel-header"><div><h2>Recently added</h2><p>The five newest records</p></div><button className="link-btn" onClick={() => go('students')}>View all</button></div>
            <ul className="recent">{recent.map(s => <li key={s._id}><div className="student-avatar">{initials(s.name)}</div><div className="grow"><strong>{s.name}</strong><span>{s.department} · Semester {s.semester}</span></div><time>{fmtDate(s.createdAt)}</time></li>)}{!recent.length && <li className="muted">{loading ? 'Loading…' : 'No students yet.'}</li>}</ul></section>
        </div>}

        {view === 'students' && <section className="panel">
          <div className="toolbar">
            <label className="select-wrap"><span>Department</span><select value={dept} onChange={e => setDept(e.target.value)}><option value="all">All departments</option>{departments.map(d => <option key={d}>{d}</option>)}</select></label>
            <label className="select-wrap"><span>Semester</span><select value={sem} onChange={e => setSem(e.target.value)}><option value="all">All semesters</option>{semesters.map(s => <option key={s} value={s}>Semester {s}</option>)}</select></label>
            {filtersOn && <button className="link-btn" onClick={clearFilters}>Clear filters</button>}
            <span className="result-count" aria-live="polite">{rows.length} {rows.length === 1 ? 'record' : 'records'}</span>
          </div>
          <div className="table-wrap"><table>
            <thead><tr><SortTh label="Student" k="name" sort={sort} onSort={onSort} /><SortTh label="ID" k="studentId" sort={sort} onSort={onSort} /><SortTh label="Department" k="department" sort={sort} onSort={onSort} /><SortTh label="Semester" k="semester" sort={sort} onSort={onSort} /><th>Contact</th><SortTh label="Added" k="createdAt" sort={sort} onSort={onSort} /><th className="actions-heading">Actions</th></tr></thead>
            <tbody>{loading && !students.length ? <Skeleton /> : pageRows.map(s => <tr key={s._id}>
              <td data-label="Student"><div className="student-cell"><div className="student-avatar">{initials(s.name)}</div><div><strong>{s.name}</strong><span><Mail size={13} />{s.email}</span></div></div></td>
              <td data-label="ID"><span className="id-pill">{s.studentId}</span></td>
              <td data-label="Department"><span className="department">{s.department}</span></td>
              <td data-label="Semester"><span className="semester-pill">Sem {s.semester}</span></td>
              <td data-label="Contact" className="contact">{s.contact ? <><Phone size={13} />{s.contact}</> : '—'}</td>
              <td data-label="Added" className="contact">{fmtDate(s.createdAt)}</td>
              <td className="row-actions-cell"><div className="row-actions"><button className="edit-action" onClick={() => openEdit(s)} aria-label={`Edit ${s.name}`}><Pencil size={15} /></button><button className="delete-action" onClick={() => setConfirm(s)} aria-label={`Delete ${s.name}`}><Trash2 size={15} /></button></div></td>
            </tr>)}</tbody>
          </table></div>
          {!loading && !rows.length && !error && <div className="empty-state"><div className="empty-icon"><Users size={26} /></div><h3>{filtersOn ? 'No matching students' : 'No students yet'}</h3><p>{filtersOn ? 'Try a different search or clear the filters.' : 'Add your first student to get started.'}</p>{filtersOn ? <button className="secondary-btn" onClick={clearFilters}>Clear filters</button> : <button className="primary-btn" onClick={openAdd}><Plus size={17} /> Add first student</button>}</div>}
          {rows.length > 0 && <div className="pagination"><span>Showing {(current - 1) * PAGE_SIZE + 1}–{Math.min(current * PAGE_SIZE, rows.length)} of {rows.length}</span><div><button className="icon-btn" onClick={() => setPage(current - 1)} disabled={current <= 1} aria-label="Previous page"><ChevronLeft size={17} /></button><span className="page-num">Page {current} of {pages}</span><button className="icon-btn" onClick={() => setPage(current + 1)} disabled={current >= pages} aria-label="Next page"><ChevronRight size={17} /></button></div></div>}
        </section>}
        <footer>StudentHub <span>•</span> React + Vite on Vercel <span>•</span> Render API <span>•</span> MongoDB Atlas</footer>
      </main>
    </div>

    {modal && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setModal(false); }}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div className="modal-heading"><div><span className="eyebrow">{editing ? 'Update record' : 'New record'}</span><h2 id="modal-title">{editing ? 'Edit student' : 'Add a student'}</h2><p>Fields marked * are required.</p></div><button className="icon-btn" onClick={() => setModal(false)} aria-label="Close dialog"><X size={19} /></button></div>
        <form onSubmit={submit} noValidate>
          {errors.form && <div className="error-banner" role="alert"><AlertCircle size={18} /><span>{errors.form}</span></div>}
          <div className="form-grid">
            <Field id="f-studentId" label="Student ID *" error={errors.studentId}><input {...fieldProps('studentId')} autoFocus maxLength="30" value={form.studentId} onChange={e => setField('studentId', e.target.value)} placeholder="e.g. ST101" /></Field>
            <Field id="f-name" label="Full name *" error={errors.name}><input {...fieldProps('name')} maxLength="100" value={form.name} onChange={e => setField('name', e.target.value)} placeholder="e.g. Rahul Sharma" /></Field>
            <Field id="f-email" label="Email address *" error={errors.email} full><input {...fieldProps('email')} type="email" value={form.email} onChange={e => setField('email', e.target.value)} placeholder="student@example.com" /></Field>
            <Field id="f-department" label="Department *" error={errors.department}><input {...fieldProps('department')} maxLength="100" value={form.department} onChange={e => setField('department', e.target.value)} placeholder="Computer Science" list="dept-list" /><datalist id="dept-list">{departments.map(d => <option key={d} value={d} />)}</datalist></Field>
            <Field id="f-semester" label="Semester *"><select id="f-semester" value={form.semester} onChange={e => setField('semester', e.target.value)}>{Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>Semester {i + 1}</option>)}</select></Field>
            <Field id="f-contact" label="Contact number" error={errors.contact} hint="Optional" full><input {...fieldProps('contact')} maxLength="20" value={form.contact} onChange={e => setField('contact', e.target.value)} placeholder="+91 98765 43210" /></Field>
          </div>
          <div className="modal-actions"><button type="button" className="secondary-btn" onClick={() => setModal(false)}>Cancel</button><button type="submit" className="primary-btn" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : <><Plus size={17} /> Add student</>}</button></div>
        </form>
      </section>
    </div>}

    {confirm && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setConfirm(null); }}>
      <section className="modal small" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-desc">
        <div className="confirm-icon"><TriangleAlert size={24} /></div>
        <h2 id="confirm-title">Delete student?</h2>
        <p id="confirm-desc">{confirm.name} ({confirm.studentId}) will be permanently removed. This cannot be undone.</p>
        <div className="modal-actions"><button className="secondary-btn" autoFocus onClick={() => setConfirm(null)}>Cancel</button><button className="danger-btn" onClick={remove} disabled={deleting}>{deleting ? 'Deleting…' : 'Delete'}</button></div>
      </section>
    </div>}
  </div>;
}
