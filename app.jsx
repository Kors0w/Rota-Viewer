import React, { useState, useEffect, useRef } from 'react';
import { 
  Moon, Sun, Upload, Download, Users, 
  Calendar, ArrowRightLeft, Printer, FileText,
  CheckCircle2, X
} from 'lucide-react';

// --- CONSTANTS & COLORS ---
// Updated Dark Mode Palette for a "Modern SaaS" look
const COLORS = {
  light: {
    early: { bg: '#ccfbf1', border: '#5eead4', text: '#0f766e' },
    std:   { bg: '#d1fae5', border: '#6ee7b7', text: '#065f46' },
    am:    { bg: '#dbeafe', border: '#93c5fd', text: '#1e40af' },
    pm:    { bg: '#f3e8ff', border: '#d8b4fe', text: '#6b21a8' },
    hol:   { bg: '#fef3c7', border: '#fcd34d', text: '#92400e' },
    off:   { bg: '#ffffff', border: '#e5e7eb', text: '#9ca3af' },
    nodata:{ bg: '#f3f4f6', border: '#d1d5db', text: '#6b7280' },
  },
  dark: {
    // Using deep, rich backgrounds with bright, readable text for high contrast
    early: { bg: '#042f2e', border: '#115e59', text: '#5eead4' }, // Teal 950 bg / Teal 800 border / Teal 300 text
    std:   { bg: '#022c22', border: '#065f46', text: '#6ee7b7' }, // Emerald
    am:    { bg: '#172554', border: '#1e40af', text: '#93c5fd' }, // Blue
    pm:    { bg: '#2e1065', border: '#5b21b6', text: '#d8b4fe' }, // Violet
    hol:   { bg: '#451a03', border: '#9a3412', text: '#fcd34d' }, // Amber
    off:   { bg: '#1e293b', border: '#334155', text: '#94a3b8' }, // Slate 800 (Off days blend in)
    nodata:{ bg: '#0f172a', border: '#1e293b', text: '#475569' }, // Slate 900 (Empty slots fade away)
  }
};

// --- HELPER FUNCTIONS ---

const normalizeTeamName = (rawName) => {
  let name = rawName.toLowerCase().trim();
  if (name === "anon") return "Uncategorized";
  if (!name || name.includes("total") || name.includes("count")) return null;
  if (name.includes("aah")) return "2nd Line AAH";
  if (name.includes("team leader") || name.includes("teamleader") || name.includes("manager")) return "Managers"; 
  if (name.includes("1st line") || name.includes("l1")) return "1st Line";
  if (name.includes("2nd line") || name.includes("l2")) return "2nd Line"; 
  if (name.includes("3rd line") || name.includes("l3")) return "3rd Line";
  return rawName.trim();
};

const parseTime = (raw) => {
  if (!raw || typeof raw !== 'string' || raw.trim() === "") {
    return { text: "NO DATA", type: "nodata", description: "No Shift Data" };
  }
  
  let s = raw.toLowerCase().trim().replace(/\s/g, '');
  if (/^\d+$/.test(s) && s.length < 3) {
    return { text: "NO DATA", type: "nodata", description: "No Shift Data" };
  }

  if (["off", "r"].includes(s)) return { text: "OFF", type: "off", description: "Day Off" };
  if (["bh", "xmas", "h", "holiday"].includes(s)) return { text: raw.toUpperCase(), type: "holiday", description: "Annual Leave" };

  let hour = 0;
  let type = "am"; // Default to generalized morning/blue

  switch(s) {
    case "6am": return { text: "06:00 - 14:30", description: "Early Shift", hour: 6, type: "early" };
    case "8am": return { text: "08:00 - 16:30", description: "Standard Shift", hour: 8, type: "am" }; 
    case "830am": return { text: "08:30 - 17:00", description: "Mid-Morning Shift", hour: 8, type: "am" };
    case "9am": return { text: "09:00 - 17:30", description: "Standard Day", hour: 9, type: "std" }; 
    case "930am": return { text: "09:30 - 18:00", description: "Late Start Shift", hour: 9, type: "am" };
    case "1230": return { text: "12:30 - 21:00", description: "Mid/Late Shift", hour: 12, type: "pm" };
    case "230pm": return { text: "14:30 - 23:00", description: "Late Afternoon Shift", hour: 14, type: "pm" };
    case "330pm": return { text: "15:30 - 00:00", description: "Closing Shift", hour: 15, type: "pm" };
    case "9-1": return { text: "09:00 - 13:00", description: "Half Day", hour: 9, type: "am" };
    default:
      let formatted = raw.trim(); 
      let isPm = s.includes("pm");
      let match = s.match(/(\d{1,2})(:?(\d{2}))?/);
      if (match) {
          let h = parseInt(match[1]);
          if (isPm && h < 12) h += 12;
          if (!isPm && h === 12) h = 0;
          hour = h; 
      }
      type = (hour >= 12 && hour < 20) ? "pm" : "am";
      if (hour >= 20 || hour < 6) type = "pm"; 
      return { text: `Shift: ${formatted}`, description: "Custom Shift", hour: hour, type: type };
  }
};

export default function RotaApp() {
  // --- STATE ---
  const [isDark, setIsDark] = useState(false);
  const [fullData, setFullData] = useState({});
  const [teamData, setTeamData] = useState({});
  const [months, setMonths] = useState([]);
  
  const [currentMonth, setCurrentMonth] = useState(null);
  const [currentTeam, setCurrentTeam] = useState("All Employees");
  const [currentEmployee, setCurrentEmployee] = useState(null);
  
  const [isConfidential, setIsConfidential] = useState(false);

  // Swap Feature State
  const [swapModalOpen, setSwapModalOpen] = useState(false);
  const [swapData, setSwapData] = useState({
    dateIndex: null,
    dateLabel: '',
    sourceShift: null,
    step: 1,
    selectedShiftType: null,
    targetEmployee: null,
    availableSwaps: {},
  });

  // Load XLSX Script
  useEffect(() => {
    if (!window.XLSX) {
      const script = document.createElement('script');
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
      script.async = true;
      document.body.appendChild(script);
    }
  }, []);

  // --- PARSING LOGIC ---
  const handleFile = (file) => {
    if (!file) return;
    const isCsv = file.name.toLowerCase().endsWith('.csv');
    const isSecure = file.name.includes("_Filtered_Secured");
    setIsConfidential(isSecure);

    const reader = new FileReader();
    reader.onload = (e) => {
      let csvContent = e.target.result;
      if (!isCsv && window.XLSX) {
        const workbook = window.XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
        csvContent = "";
        workbook.SheetNames.forEach(sheet => {
          csvContent += window.XLSX.utils.sheet_to_csv(workbook.Sheets[sheet]) + "\n\n";
        });
      }
      parseRota(csvContent, isSecure);
    };
    if (isCsv) reader.readAsText(file);
    else reader.readAsArrayBuffer(file);
  };

  const parseRota = (csvText, isSecureFile) => {
    const lines = csvText.split(/\r\n|\n/);
    const newFullData = {};
    const newTeamData = {};
    let parseMonth = null;
    let capture = false;
    let parsingTeam = "Uncategorized";
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

    lines.forEach(line => {
      const row = line.split(',');
      const rowStr = row.join(' ');
      
      const foundM = monthNames.find(m => rowStr.includes(m));
      if (foundM && !rowStr.includes("Service Desk")) {
        parseMonth = foundM;
        if (!newFullData[parseMonth]) newFullData[parseMonth] = { emps: {}, days: [] };
        if (!newTeamData[parseMonth]) newTeamData[parseMonth] = {};
        capture = false;
        parsingTeam = "Uncategorized";
        return;
      }
      if (!parseMonth) return;

      if (row[1] === "Name") {
        capture = true;
        let headerDays = row.slice(2, 33).map(d => d.trim());
        if (headerDays[0]) newFullData[parseMonth].days = headerDays;
        return;
      }
      
      if (capture) {
        let teamRaw = row[0] ? row[0].trim() : "";
        let name = row[1] ? row[1].trim() : "";
        let shifts = row.slice(2, 33);
        while (shifts.length < 31) shifts.push("");

        if (teamRaw.length > 1) {
           parsingTeam = normalizeTeamName(teamRaw) || teamRaw;
        }

        let employeeName = name;
        let employeeTeam = parsingTeam;

        if (name.match(/^(replacement\s+\d+)/i)) {
          employeeName = name.replace(/replacement/i, "Overtime");
          employeeTeam = "Overtime";
        }

        if (!employeeName) return;

        const realShiftCount = shifts.filter(s => {
          let str = s.trim().toLowerCase();
          if (!str) return false;
          if (["off", "x", "r", "h", "holiday", "sick", "vacation", "annual leave", "bh", "xmas"].includes(str)) return false;
          if (/^\d+$/.test(str) && str.length < 3) return false;
          return true;
        }).length;

        if (!isSecureFile && realShiftCount < 5) return; 
        if (realShiftCount === 0) return;

        newFullData[parseMonth].emps[employeeName] = { shifts, team: employeeTeam };
        
        if (!newTeamData[parseMonth][employeeTeam]) newTeamData[parseMonth][employeeTeam] = [];
        if (!newTeamData[parseMonth][employeeTeam].includes(employeeName)) {
          newTeamData[parseMonth][employeeTeam].push(employeeName);
        }
      }
    });

    const loadedMonths = Object.keys(newFullData);
    setFullData(newFullData);
    setTeamData(newTeamData);
    setMonths(loadedMonths);
    
    if (loadedMonths.length > 0) {
      const initialMonth = loadedMonths.includes("November") ? "November" : loadedMonths[loadedMonths.length - 1];
      setCurrentMonth(initialMonth);
    }
  };

  useEffect(() => {
    if (currentMonth && teamData[currentMonth]) {
       setCurrentTeam("All Employees"); 
    }
  }, [currentMonth, teamData, isConfidential]);

  useEffect(() => {
    if (currentMonth && currentTeam && fullData[currentMonth]) {
      let emps = [];
      if (currentTeam === "All Employees") {
        // Collect all employees from all teams for "All Employees" view
        emps = Object.keys(fullData[currentMonth].emps || {}).sort();
      } else if (teamData[currentMonth]?.[currentTeam]) {
        emps = teamData[currentMonth][currentTeam].sort();
      }
      if (!currentEmployee || !emps.includes(currentEmployee)) { 
        setCurrentEmployee(emps[0] || null);
      }
    }
  }, [currentMonth, currentTeam, fullData, teamData]);


  // --- SWAP LOGIC ---
  const openSwapModal = (dayIndex, dateLabel, shiftData) => {
    if (!shiftData || shiftData.type === 'off' || shiftData.type === 'holiday' || shiftData.type === 'nodata') return;

    const monthData = fullData[currentMonth];
    if (!monthData || !currentEmployee || !monthData.emps[currentEmployee]) return;

    const userRecord = monthData.emps[currentEmployee];
    const userTeam = userRecord.team;
    
    // Determine the pool of swap partners: All employees if viewing 'All Employees', otherwise, just the team members.
    const teamMembers = currentTeam === "All Employees" 
      ? Object.keys(monthData.emps)
      : (teamData[currentMonth]?.[userTeam] || []);
    
    const available = {}; 

    teamMembers.forEach(member => {
      if (member === currentEmployee) return; 
      
      const memberRecord = monthData.emps[member];
      if (!memberRecord) return;

      const memberShiftRaw = memberRecord.shifts[dayIndex];
      const parsed = parseTime(memberShiftRaw);
      
      // Only allow swapping with someone who is currently working a different shift
      if (parsed.type !== 'off' && parsed.type !== 'holiday' && parsed.type !== 'nodata' && parsed.description !== shiftData.description) {
        const key = parsed.description; 
        if (!available[key]) available[key] = { parsedInfo: parsed, employees: [] };
        available[key].employees.push({ name: member, raw: memberShiftRaw, parsed });
      }
    });

    setSwapData({
      dateIndex: dayIndex,
      dateLabel: dateLabel,
      sourceShift: shiftData,
      step: 1,
      selectedShiftType: null,
      targetEmployee: null,
      availableSwaps: available
    });
    setSwapModalOpen(true);
  };

  const handlePrintSwap = () => {
    window.print();
  };

  // --- RENDER HELPERS ---
  const getStyle = (type) => {
    const pal = isDark ? COLORS.dark : COLORS.light;
    return pal[type] || pal.nodata;
  };

  const renderCalendar = () => {
    if (!currentMonth || !currentEmployee || !fullData[currentMonth]) {
      return { 
        grid: [
          <div key="placeholder" className="col-span-7 p-12 text-center border-2 border-dashed border-gray-300 dark:border-slate-700 rounded-xl text-gray-400 dark:text-slate-500">
            <p>Please load a rota file and select an employee.</p>
          </div>
        ],
        stats: { workDays: 0, offDays: 0 } 
      };
    }

    const employeeData = fullData[currentMonth].emps[currentEmployee];
    
    if (!employeeData) {
         return { 
            grid: [
              <div key="placeholder-emp" className="col-span-7 p-12 text-center border-2 border-dashed border-gray-300 dark:border-slate-700 rounded-xl text-gray-400 dark:text-slate-500">
                <p>Employee data not found for the current month.</p>
              </div>
            ],
            stats: { workDays: 0, offDays: 0 } 
          };
    }

    const shifts = employeeData.shifts;
    const monthIndex = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"].indexOf(currentMonth);
    const year = new Date().getFullYear();
    const firstDay = new Date(year, monthIndex, 1).getDay();
    // Adjust start day to Monday=0, Sunday=6. JS getDay is Sunday=0, Monday=1...
    // offset = days to skip before the 1st day of the month
    const offset = firstDay === 0 ? 6 : firstDay - 1; 

    const grid = [];
    for (let i = 0; i < offset; i++) grid.push(<div key={`empty-${i}`} className="invisible" />);

    let workDays = 0;
    let offDays = 0;

    shifts.forEach((raw, idx) => {
      if (idx >= 31) return;
      const parsed = parseTime(raw);
      if (parsed.type === 'off' || parsed.type === 'holiday') offDays++;
      else if (parsed.type !== 'nodata') workDays++;

      const style = getStyle(parsed.type);
      const isSwappable = parsed.type !== 'off' && parsed.type !== 'holiday' && parsed.type !== 'nodata';

      grid.push(
        <div 
          key={`day-${idx}`}
          onClick={isSwappable ? () => openSwapModal(idx, `${idx + 1} ${currentMonth}`, parsed) : undefined}
          className={`relative group min-h-[100px] p-3 rounded-xl border transition-all duration-200 ${
            isSwappable 
              ? 'cursor-pointer hover:shadow-lg hover:-translate-y-1 hover:ring-2 hover:ring-offset-2 hover:ring-blue-400 dark:hover:ring-blue-500 dark:hover:ring-offset-slate-900' 
              : 'cursor-default opacity-80'
          }`}
          style={{ 
            backgroundColor: style.bg, 
            borderColor: style.border, 
            color: style.text 
          }}
        >
          <div className="flex justify-between items-start mb-1">
            <span className="text-lg font-bold opacity-70">{idx + 1}</span>
            {isSwappable && (
               <ArrowRightLeft className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity" />
            )}
          </div>
          <div className="text-center mt-2">
            <div className="font-bold text-sm md:text-base leading-tight">{parsed.description}</div>
            <div className="text-xs font-medium mt-1 opacity-80">{parsed.text}</div>
          </div>
        </div>
      );
    });

    return { grid, stats: { workDays, offDays } };
  };

  const { grid, stats } = renderCalendar();

  const getTeamsList = () => {
    if (!currentMonth || !teamData[currentMonth]) return [];
    // Filter out "Uncategorized" and "Managers" if there are no members in them, otherwise keep them.
    const teams = Object.keys(teamData[currentMonth]).filter(t => (t !== "Uncategorized" && t !== "Managers") || teamData[currentMonth][t].length > 0);
    
    // Add "All Employees" first, then Managers if it exists and has members, then sorted rest, then Uncategorized if it exists and has members
    const list = ["All Employees"];
    if (teamData[currentMonth]?.["Managers"]?.length) list.push("Managers");
    list.push(...teams.filter(t => t !== "Managers" && t !== "Uncategorized").sort());
    if (teamData[currentMonth]?.["Uncategorized"]?.length) list.push("Uncategorized");
    
    return list;
  };

  // --- APP SHELL ---
  return (
    <div className={`min-h-screen transition-colors duration-500 ease-in-out ${isDark ? 'bg-slate-950 text-slate-200' : 'bg-gray-50 text-gray-900'}`}>
      
      {/* --- HEADER --- */}
      <header className={`sticky top-0 z-30 backdrop-blur-lg border-b px-6 py-4 flex flex-wrap gap-4 items-center justify-between transition-colors duration-500 ${isDark ? 'bg-slate-900/80 border-slate-800' : 'bg-white/80 border-gray-200'}`}>
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-600 rounded-lg shadow-lg shadow-blue-500/30">
            <Calendar className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-xl font-bold tracking-tight">Service Desk Rota</h1>
        </div>

        <div className="flex items-center gap-3">
          <button 
            onClick={() => setIsDark(!isDark)}
            className={`p-2 rounded-lg transition-all duration-300 ${
              isDark 
                ? 'bg-slate-800 hover:bg-slate-700 text-amber-400 ring-1 ring-slate-700' 
                : 'bg-gray-100 hover:bg-gray-200 text-gray-600'
            }`}
          >
            {isDark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </button>
          
          <label className={`cursor-pointer flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all shadow-lg ${
            isDark 
              ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-900/20' 
              : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-500/20'
          }`}>
            <Upload className="w-4 h-4" />
            <span>Load File</span>
            <input type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={(e) => handleFile(e.target.files[0])} />
          </label>
        </div>
      </header>

      {/* --- MAIN CONTENT --- */}
      <main className="max-w-7xl mx-auto p-4 md:p-8">
        
        {/* Controls Card */}
        <div className={`rounded-2xl shadow-xl border p-6 mb-8 transition-all duration-500 ${isDark ? 'bg-slate-900 border-slate-800 shadow-slate-900/50' : 'bg-white border-gray-200'}`}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            
            {/* Select Inputs */}
            {[
              { label: 'Month', val: currentMonth, set: setCurrentMonth, opts: months, disabled: months.length === 0 },
              { label: 'Team', val: currentTeam, set: setCurrentTeam, opts: getTeamsList(), disabled: isConfidential || !currentMonth },
              { label: 'Employee', val: currentEmployee, set: setCurrentEmployee, opts: currentMonth && currentTeam ? (currentTeam === "All Employees" ? Object.keys(fullData[currentMonth]?.emps || {}).sort() : (teamData[currentMonth]?.[currentTeam] || [])) : [], disabled: !currentMonth }
            ].map((field, i) => (
              <div key={i} className="space-y-2">
                <label className={`text-xs font-bold uppercase tracking-wider ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>{field.label}</label>
                <div className="relative">
                  <select 
                    value={field.val || ''} 
                    onChange={(e) => field.set(e.target.value)}
                    disabled={field.disabled}
                    className={`w-full p-3 rounded-lg border appearance-none font-medium outline-none focus:ring-2 transition-colors ${
                      isDark 
                        ? 'bg-slate-800 border-slate-700 text-slate-200 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:bg-slate-900' 
                        : 'bg-gray-50 border-gray-200 text-gray-900 focus:ring-blue-500'
                    }`}
                  >
                    {field.opts.length === 0 && <option value="">{i === 0 ? "Load file first..." : "Select..."}</option>}
                    {field.opts.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
              </div>
            ))}
          </div>

          {/* Stats Display */}
          {currentEmployee && (
            <div className={`flex gap-8 mt-8 pt-6 border-t border-dashed ${isDark ? 'border-slate-700' : 'border-gray-200'}`}>
              <div className="flex items-baseline gap-2">
                <span className={`text-3xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>{stats?.workDays || 0}</span>
                <span className={`text-sm font-medium ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>Work Days</span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className={`text-3xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>{stats?.offDays || 0}</span>
                <span className={`text-sm font-medium ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>Off / Leave</span>
              </div>
            </div>
          )}
        </div>

        {/* Calendar Grid */}
        <div className={`rounded-2xl shadow-sm border overflow-hidden transition-all duration-500 ${isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-gray-200'}`}>
          {/* Week Header */}
          <div className={`grid grid-cols-7 border-b ${isDark ? 'border-slate-800 bg-slate-950/30' : 'border-gray-200 bg-gray-50'}`}>
            {['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].map(day => (
              <div key={day} className={`py-3 text-center text-xs font-bold tracking-widest ${isDark ? 'text-slate-500' : 'text-gray-400'}`}>
                {day}
              </div>
            ))}
          </div>
          
          {/* Days Grid */}
          <div className={`grid grid-cols-7 gap-px border-b-4 border-transparent p-4 gap-y-4 gap-x-4 ${isDark ? 'bg-slate-950' : 'bg-gray-200'}`}>
             {grid}
          </div>
        </div>
      </main>

      {/* --- SWAP MODAL --- */}
      {swapModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className={`w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] transition-colors ${isDark ? 'bg-slate-900 text-slate-200 border border-slate-700' : 'bg-white text-gray-900'}`}>
            
            {/* Modal Header */}
            <div className={`p-6 border-b flex justify-between items-center ${isDark ? 'border-slate-700' : 'border-gray-200'}`}>
              <div>
                <h2 className="text-xl font-bold">Shift Swap Request</h2>
                <p className={`text-sm ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>For {swapData.dateLabel}</p>
              </div>
              <button onClick={() => setSwapModalOpen(false)} className={`p-2 rounded-full transition-colors ${isDark ? 'hover:bg-slate-800 text-slate-400' : 'hover:bg-gray-100'}`}>
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto flex-1">
              
              {/* STEP 1 */}
              {swapData.step === 1 && (
                <div className="space-y-4">
                  <h3 className={`font-semibold ${isDark ? 'text-slate-300' : 'text-gray-700'}`}>1. Select a shift to swap for:</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {Object.keys(swapData.availableSwaps).length === 0 ? (
                      <div className="col-span-2 py-8 text-center opacity-50 italic">No swappable shifts found from teammates on this day.</div>
                    ) : (
                      Object.entries(swapData.availableSwaps).map(([desc, data]) => (
                        <button
                          key={desc}
                          onClick={() => setSwapData(prev => ({ ...prev, selectedShiftType: desc, step: 2 }))}
                          className={`p-4 rounded-xl border text-left transition-all hover:scale-[1.02] ${
                            isDark 
                              ? 'border-slate-700 bg-slate-800 hover:bg-slate-700 hover:border-blue-500' 
                              : 'border-gray-200 hover:bg-blue-50 hover:border-blue-300'
                          }`}
                        >
                          <div className="font-bold text-lg mb-1">{desc}</div>
                          <div className={`text-xs ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>{data.parsedInfo.text}</div>
                          <div className={`mt-3 text-xs font-medium px-2 py-1 rounded w-fit ${isDark ? 'bg-slate-900 text-slate-300' : 'bg-gray-200 text-gray-700'}`}>
                            {data.employees.length} {data.employees.length === 1 ? 'Person' : 'People'}
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* STEP 2 */}
              {swapData.step === 2 && (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 mb-4">
                    <button onClick={() => setSwapData(prev => ({ ...prev, step: 1 }))} className="text-sm hover:underline opacity-60">← Back</button>
                    <h3 className="font-semibold opacity-80">2. Who would you like to swap with?</h3>
                  </div>
                  
                  <div className="space-y-2">
                    {swapData.availableSwaps[swapData.selectedShiftType].employees.map((emp) => (
                      <button
                        key={emp.name}
                        onClick={() => setSwapData(prev => ({ ...prev, targetEmployee: emp, step: 3 }))}
                        className={`w-full flex items-center justify-between p-4 rounded-xl border transition-colors ${
                          isDark 
                            ? 'border-slate-700 bg-slate-800 hover:bg-slate-700' 
                            : 'border-gray-200 hover:bg-gray-50'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 mx-auto rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-bold text-xs">
                            {emp.name.substring(0,2).toUpperCase()}
                          </div>
                          <span className="font-medium">{emp.name}</span>
                        </div>
                        <ArrowRightLeft className="w-4 h-4 opacity-40" />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* STEP 3 */}
              {swapData.step === 3 && (
                <div className="flex flex-col items-center animate-in zoom-in duration-300">
                   {/* PRINTABLE AREA */}
                   <div id="swap-card" className={`w-full max-w-lg border-2 rounded-xl p-8 relative overflow-hidden print:border-none print:w-full print:max-w-none ${isDark ? 'bg-slate-950 border-slate-700' : 'bg-white border-gray-200'}`}>
                      {/* Watermark */}
                      <div className="absolute top-[-20%] right-[-20%] w-64 h-64 bg-blue-500/10 rounded-full blur-3xl pointer-events-none"></div>

                      <div className="text-center mb-8">
                        <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold tracking-wider uppercase mb-2 ${isDark ? 'bg-blue-900/30 text-blue-300' : 'bg-blue-100 text-blue-700'}`}>
                          Official Request
                        </div>
                        <h2 className="text-2xl font-bold">Shift Swap Proposal</h2>
                        <p className="opacity-60 mt-1">{swapData.dateLabel}</p>
                      </div>

                      <div className="flex items-center justify-between gap-4 relative">
                        {/* Source */}
                        <div className="flex-1 text-center z-10">
                          <div className={`w-16 h-16 mx-auto mb-3 rounded-full flex items-center justify-center text-xl font-bold border-2 border-blue-500 ${isDark ? 'bg-slate-900' : 'bg-gray-100'}`}>
                            {currentEmployee.substring(0,2).toUpperCase()}
                          </div>
                          <div className="font-bold truncate max-w-[120px] mx-auto">{currentEmployee}</div>
                          <div className="text-sm opacity-60 mt-1">{swapData.sourceShift.description}</div>
                          <div className="text-xs opacity-40 mt-1">({swapData.sourceShift.text})</div>
                        </div>

                        {/* Icon */}
                        <div className="flex flex-col items-center justify-center z-10">
                          <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center shadow-lg shadow-blue-500/30">
                            <ArrowRightLeft className="text-white w-5 h-5" />
                          </div>
                        </div>

                        {/* Target */}
                        <div className="flex-1 text-center z-10">
                          <div className={`w-16 h-16 mx-auto mb-3 rounded-full flex items-center justify-center text-xl font-bold border-2 border-purple-500 ${isDark ? 'bg-slate-900' : 'bg-gray-100'}`}>
                            {swapData.targetEmployee.name.substring(0,2).toUpperCase()}
                          </div>
                          <div className="font-bold truncate max-w-[120px] mx-auto">{swapData.targetEmployee.name}</div>
                          <div className="text-sm opacity-60 mt-1">{swapData.targetEmployee.parsed.description}</div>
                          <div className="text-xs opacity-40 mt-1">({swapData.targetEmployee.parsed.text})</div>
                        </div>
                      </div>

                      <div className={`mt-8 pt-6 border-t border-dashed flex justify-between items-center text-xs opacity-50 ${isDark ? 'border-slate-800' : 'border-gray-300'}`}>
                        <span>Generated by Service Desk Rota</span>
                        <span>{new Date().toLocaleDateString()}</span>
                      </div>
                   </div>

                   <div className="mt-8 flex gap-4 w-full">
                     <button 
                        onClick={() => setSwapData(prev => ({...prev, step: 2}))}
                        className={`flex-1 py-3 rounded-lg border font-medium transition-colors ${isDark ? 'border-slate-700 hover:bg-slate-800' : 'hover:bg-gray-100'}`}
                      >
                        Change Partner
                      </button>
                      <button 
                        onClick={handlePrintSwap}
                        className="flex-[2] py-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold shadow-lg shadow-blue-500/20 flex items-center justify-center gap-2 transition-colors"
                      >
                        <Printer className="w-5 h-5" />
                        Print / Save as PDF
                      </button>
                   </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <style>{`
        @media print {
          body * { visibility: hidden; }
          #swap-card, #swap-card * { visibility: visible; }
          #swap-card { 
            position: absolute; 
            left: 50%; 
            top: 50%; 
            transform: translate(-50%, -50%);
            width: 100%;
            max-width: 600px;
            border: 2px solid #ddd !important;
            box-shadow: none !important;
            background-color: white !important; 
            color: black !important;
          }
        }
      `}</style>
    </div>
  );
}