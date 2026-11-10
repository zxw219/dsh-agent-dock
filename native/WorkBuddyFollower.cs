using System;
using System.Collections.Generic;
using System.Collections.Concurrent;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Threading;

namespace DSH {
// Public out-of-context WinEvent hooks; no injection, parenting, owner or style changes.
public static class WorkBuddyFollower {
  [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left, Top, Right, Bottom; public int Width { get { return Right-Left; } } public int Height { get { return Bottom-Top; } } }
  [StructLayout(LayoutKind.Sequential)] struct POINT { public int X,Y; }
  [StructLayout(LayoutKind.Sequential)] struct MSG { public IntPtr hwnd; public uint message; public UIntPtr wParam; public IntPtr lParam; public uint time; public POINT pt; public uint lPrivate; }
  delegate bool EnumProc(IntPtr hwnd, IntPtr param);
  delegate void EventProc(IntPtr hook,uint evt,IntPtr hwnd,int obj,int child,uint thread,uint time);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc proc,IntPtr p);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent,EnumProc proc,IntPtr p);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll",EntryPoint="GetWindowLongPtrW")] static extern IntPtr GetWindowLongPtr(IntPtr h,int index);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h,StringBuilder text,int count);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h,StringBuilder text,int count);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h,out RECT rect);
  [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h,out RECT rect);
  [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr h,ref POINT p);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h,uint flags);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h,uint cmd);
  [DllImport("user32.dll",SetLastError=true)] static extern bool SetWindowPos(IntPtr h,IntPtr after,int x,int y,int cx,int cy,uint flags);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h,int command);
  [DllImport("user32.dll")] static extern IntPtr SetWinEventHook(uint min,uint max,IntPtr module,EventProc proc,uint pid,uint tid,uint flags);
  [DllImport("user32.dll")] static extern bool UnhookWinEvent(IntPtr hook);
  [DllImport("user32.dll")] static extern bool PeekMessage(out MSG msg,IntPtr hwnd,uint min,uint max,uint remove);
  [DllImport("user32.dll")] static extern bool TranslateMessage(ref MSG msg);
  [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref MSG msg);
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr h);
  const uint NOACTIVATE=0x10, NOOWNERZORDER=0x200, NOZORDER=4;
  sealed class Identity {
    public IntPtr Window; public int Pid; public long Started; public string Path; public string Title;
    public static Identity Capture(IntPtr h,string exe,int expectedPid,string title) {
      uint pid; if(!IsWindow(h)||GetAncestor(h,2)!=h) throw new Exception("Window is not an existing top-level window");
      GetWindowThreadProcessId(h,out pid); if(expectedPid>0&&pid!=expectedPid) throw new Exception("Window PID changed");
      using(var p=Process.GetProcessById((int)pid)) {
        string path=p.MainModule.FileName;
        if(!String.Equals(System.IO.Path.GetFileName(path),exe,StringComparison.OrdinalIgnoreCase)) throw new Exception("Unexpected executable identity");
        if(title!=null&&!String.Equals(Text(h),title,StringComparison.Ordinal)) throw new Exception("Popup title changed");
        return new Identity{Window=h,Pid=(int)pid,Started=p.StartTime.ToUniversalTime().Ticks,Path=path,Title=title};
      }
    }
    public bool Alive() { try { var now=Capture(Window,System.IO.Path.GetFileName(Path),Pid,Title); return now.Started==Started&&String.Equals(now.Path,Path,StringComparison.OrdinalIgnoreCase); } catch { return false; } }
  }
  sealed class View { public double X,Y,W,H,Dpr,SX,SY,SW,SH,IW,IH; public bool Visible; }
  static readonly ConcurrentQueue<string> queue=new ConcurrentQueue<string>();
  static readonly List<IntPtr> hooks=new List<IntPtr>();
  static readonly EventProc eventProc=Event;
  static Identity target,host; static IntPtr renderer,lastForeground; static RECT original; static bool originalVisible,changed,dirty,quitting; static volatile bool eof; static View view;
  sealed class Parked { public Identity Target; public RECT Original; public bool Visible; }
  static readonly List<Parked> parked=new List<Parked>();
  static long beat; static volatile string deferredError;
  static string Text(IntPtr h) { var b=new StringBuilder(2048); GetWindowText(h,b,b.Capacity); return b.ToString(); }
  static string Class(IntPtr h) { var b=new StringBuilder(256); GetClassName(h,b,b.Capacity); return b.ToString(); }
  static RECT Bounds(IntPtr h) { RECT r; if(!GetWindowRect(h,out r)) throw new Win32Exception(Marshal.GetLastWin32Error(),"GetWindowRect failed"); return r; }
  static long Now() { return Environment.TickCount64; }
  static double Number(JsonElement e,string name) { double n=e.GetProperty(name).GetDouble(); if(Double.IsNaN(n)||Double.IsInfinity(n)) throw new Exception("Invalid geometry"); return n; }
  static void Output(object obj) { Console.Out.WriteLine(JsonSerializer.Serialize(obj)); Console.Out.Flush(); }
  static void Event(IntPtr hook,uint evt,IntPtr hwnd,int obj,int child,uint thread,uint time) {
    if(target==null) return;
    if(evt==3 || (host!=null && (hwnd==host.Window || hwnd==renderer)) || hwnd==target.Window) dirty=true;
  }
  static void Install(uint pid) {
    foreach(var range in new uint[][] { new uint[]{0x8000,0x8003}, new uint[]{0x800B,0x800B},new uint[]{0x16,0x17} }) {
      IntPtr hook=SetWinEventHook(range[0],range[1],IntPtr.Zero,eventProc,pid,0,0);
      if(hook==IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(),"SetWinEventHook failed"); hooks.Add(hook);
    }
  }
  static void ClearHooks() { foreach(var h in hooks) UnhookWinEvent(h); hooks.Clear(); }
  static void EnsureTarget() { if(target==null||!target.Alive()) throw new Exception("Popup identity is no longer valid; no window was moved"); }
  static void Visibility(bool visible) {
    EnsureTarget(); if(IsWindowVisible(target.Window)==visible) return;
    changed=true; ShowWindow(target.Window,visible?8:0);
    if(IsWindowVisible(target.Window)!=visible) throw new Exception("ShowWindow visibility postcondition failed");
  }
  static void Position(RECT r,bool zorder) {
    EnsureTarget(); RECT before=Bounds(target.Window);
    if(before.Left==r.Left&&before.Top==r.Top&&before.Width==r.Width&&before.Height==r.Height&&!zorder) return;
    changed=true;
    if(!SetWindowPos(target.Window,IntPtr.Zero,r.Left,r.Top,r.Width,r.Height,NOACTIVATE|NOOWNERZORDER|(zorder?0:NOZORDER))) throw new Win32Exception(Marshal.GetLastWin32Error(),"SetWindowPos failed");
    RECT after=Bounds(target.Window);
    if(after.Left!=r.Left||after.Top!=r.Top||after.Width!=r.Width||after.Height!=r.Height) throw new Exception("SetWindowPos rectangle postcondition failed (window minimum size or DPI mismatch)");
  }
  static void Park() {
    if(target==null) return;
    EnsureTarget(); Visibility(false);
    parked.Add(new Parked{Target=target,Original=original,Visible=originalVisible});
    ClearHooks(); target=null; host=null; renderer=IntPtr.Zero; view=null; changed=false;
  }
  static object RestoreAll() {
    var errors=new List<string>();
    try { Restore(); } catch(Exception ex) { errors.Add(ex.Message); }
    foreach(var p in parked) {
      if(!p.Target.Alive()) continue;
      target=p.Target; original=p.Original; originalVisible=p.Visible; changed=true;
      try { Restore(); } catch(Exception ex) { errors.Add(ex.Message); }
    }
    parked.Clear();
    if(errors.Count>0) throw new Exception(String.Join("; ",errors));
    return new {attached=false,restored=true};
  }
  static object Restore() {
    ClearHooks(); host=null; renderer=IntPtr.Zero; lastForeground=IntPtr.Zero; view=null;
    if(target==null) return new { attached=false,restored=true };
    if(!target.Alive()) { target=null; changed=false; throw new Exception("Popup identity changed or popup closed; restoration skipped to avoid another window"); }
    var errors=new List<string>();
    if(changed) {
      try { Position(original,false); } catch(Exception ex) { errors.Add(ex.Message); }
      try { Visibility(originalVisible); } catch(Exception ex) { errors.Add(ex.Message); }
    }
    if(errors.Count>0) throw new Exception("Popup restoration: "+String.Join("; ",errors));
    target=null; changed=false; return new {attached=false,restored=true};
  }
  static void ResolveHost(View v) {
    var candidates=new List<Identity>();
    EnumWindows((h,p)=>{
      if(!IsWindowVisible(h)||IsIconic(h)) return true;
      try { var id=Identity.Capture(h,"DeepSeek Harness.exe",0,null); RECT b=Bounds(h);
        // Electron screenX/outerWidth use DIP. Permit browser rounding and invisible resize borders.
        double scale=GetDpiForWindow(h)/96.0, tol=18*scale;
        // Screen geometry is in OS DIPs; page zoom affects DPR, not outer dimensions.
        if(Math.Abs(b.Left-v.SX*scale)<=tol&&Math.Abs(b.Top-v.SY*scale)<=tol&&Math.Abs(b.Width-v.SW*scale)<=tol&&Math.Abs(b.Height-v.SH*scale)<=tol) candidates.Add(id);
      } catch {} return true;
    },IntPtr.Zero);
    if(candidates.Count!=1) throw new Exception("Cannot uniquely identify DSH window from screen geometry");
    host=candidates[0];
    if(view==null&&GetForegroundWindow()==target.Window) {
      SetForegroundWindow(host.Window);
      // Chromium may expose its native renderer only after its occluded host repaints.
      for(int attempt=0;attempt<10;attempt++) { MSG m; while(PeekMessage(out m,IntPtr.Zero,0,0,1)) { TranslateMessage(ref m); DispatchMessage(ref m); } Thread.Sleep(30); }
    }
    var renders=new List<IntPtr>();
    EnumChildWindows(host.Window,(h,p)=>{ if(Class(h)=="Chrome_RenderWidgetHostHWND"&&IsWindowVisible(h)) {
      uint pid; GetWindowThreadProcessId(h,out pid);
      RECT r; if(GetClientRect(h,out r)&&r.Width>0&&r.Height>0&&Math.Abs(r.Width-v.IW*v.Dpr)<=4&&Math.Abs(r.Height-v.IH*v.Dpr)<=4) renders.Add(h);
    } return true; },IntPtr.Zero);
    if(renders.Count!=1) throw new Exception("Cannot uniquely verify Chrome renderer client origin");
    renderer=renders[0];
    ClearHooks(); Install((uint)host.Pid);
    IntPtr fg=SetWinEventHook(3,3,IntPtr.Zero,eventProc,0,0,0);
    if(fg==IntPtr.Zero) throw new Exception("Foreground WinEventHook failed"); hooks.Add(fg);
  }
  static bool RelatedForeground() {
    IntPtr fg=GetForegroundWindow(); if(fg==IntPtr.Zero) return false;
    IntPtr root=GetAncestor(fg,2);
    for(int i=0;i<16&&root!=IntPtr.Zero;i++) { if(root==host.Window||root==target.Window) return true; root=GetWindow(root,4); }
    return false;
  }
  static void Apply() {
    EnsureTarget(); if(view==null||host==null) return;
    if(IsIconic(target.Window)) throw new Exception("Popup minimized; following released");
    if(!host.Alive()) throw new Exception("DSH window destroyed or identity changed");
    if(!view.Visible||!IsWindowVisible(host.Window)||IsIconic(host.Window)||!RelatedForeground()) { Visibility(false); lastForeground=IntPtr.Zero; return; }
    // Electron can recreate this child during minimize/restore. Hide until the next
    // viewport resolves and verifies the new renderer; retain the popup identity.
    if(!IsWindow(renderer)||Class(renderer)!="Chrome_RenderWidgetHostHWND"||GetAncestor(renderer,2)!=host.Window) { Visibility(false); return; }
    RECT cr; if(!GetClientRect(renderer,out cr)) throw new Exception("Renderer client rectangle unavailable");
    // Native movement is followed without JS; a resize requires new frontend geometry.
    if(Math.Abs(cr.Width-view.IW*view.Dpr)>4||Math.Abs(cr.Height-view.IH*view.Dpr)>4) { Visibility(false); return; }
    POINT origin=new POINT(); if(!ClientToScreen(renderer,ref origin)) throw new Exception("Renderer origin unavailable");
    RECT r=new RECT{Left=origin.X+(int)Math.Round(view.X*view.Dpr),Top=origin.Y+(int)Math.Round(view.Y*view.Dpr)};
    r.Right=r.Left+(int)Math.Round(view.W*view.Dpr); r.Bottom=r.Top+(int)Math.Round(view.H*view.Dpr);
    IntPtr foreground=GetForegroundWindow();
    bool promote=foreground!=lastForeground&&GetAncestor(foreground,2)==host.Window;
    Position(r,promote); Visibility(true); lastForeground=foreground;
  }
  static object Command(JsonElement e) {
    string op=e.GetProperty("op").GetString(); beat=Now();
    if(op=="heartbeat") { if(target!=null) { EnsureTarget(); if(host!=null&&!host.Alive()) throw new Exception("DSH window destroyed or identity changed"); } return new {alive=true,attached=target!=null}; }
    if(op=="release") return RestoreAll();
    if(op=="exit") { object result=RestoreAll(); quitting=true; return result; }
    if(op=="attach") {
      Park(); var t=e.GetProperty("target"); long h=Int64.Parse(t.GetProperty("window").GetString()); int pid=t.GetProperty("pid").GetInt32(); string title=t.GetProperty("title").GetString();
      if(h<=0||pid<=0||String.IsNullOrWhiteSpace(title)) throw new Exception("Invalid popup identity");
      target=Identity.Capture(new IntPtr(h),"WorkBuddy.exe",pid,title);
      if(IsIconic(target.Window)||((GetWindowLongPtr(target.Window,-20).ToInt64()&8)!=0)) { target=null; throw new Exception("Popup must be restored and non-topmost before attachment"); }
      var prior=parked.Find(p=>p.Target.Window==target.Window&&p.Target.Started==target.Started);
      original=prior!=null?prior.Original:Bounds(target.Window); originalVisible=prior!=null?prior.Visible:IsWindowVisible(target.Window); changed=prior!=null;
      if(prior!=null) parked.Remove(prior);
      return new {attached=true,window=h.ToString(),pid=pid,title=title};
    }
    if(op=="viewport") {
      EnsureTarget(); var v=e.GetProperty("viewport");
      if(!v.GetProperty("visible").GetBoolean()) { if(view!=null) view.Visible=false; Visibility(false); return new {attached=true,visible=false,window=target.Window.ToString()}; }
      var r=v.GetProperty("rect"); var s=v.GetProperty("screen");
      var next=new View{X=Number(r,"x"),Y=Number(r,"y"),W=Number(r,"width"),H=Number(r,"height"),Dpr=Number(v,"devicePixelRatio"),Visible=v.GetProperty("visible").GetBoolean(),SX=Number(s,"x"),SY=Number(s,"y"),SW=Number(s,"width"),SH=Number(s,"height"),IW=Number(s,"innerWidth"),IH=Number(s,"innerHeight")};
      if(next.Dpr<0.5||next.Dpr>4||next.W<1||next.H<1||next.IW<1||next.IH<1||next.SW<1||next.SH<1||next.X<0||next.Y<0||next.X+next.W>next.IW+1||next.Y+next.H>next.IH+1) throw new Exception("Viewport is outside verified browser client area");
      ResolveHost(next);
      // After the user-requested popup open, return focus to the verified DSH host
      // once, only while that exact popup is still foreground. Never steal from other apps.
      if(view==null&&GetForegroundWindow()==target.Window) SetForegroundWindow(host.Window);
      view=next; Apply();
      return new {attached=true,visible=IsWindowVisible(target.Window),window=target.Window.ToInt64().ToString()};
    }
    throw new Exception("Unknown follower operation");
  }
  public static void Run() {
    // Per-monitor-v2 affects only this worker thread, never either target process.
    SetThreadDpiAwarenessContext(new IntPtr(-4)); beat=Now(); eof=false; quitting=false;
    var reader=new Thread(()=>{ try { string line; while((line=Console.In.ReadLine())!=null) { if(line.Length>65536) { deferredError="Follower request exceeds limit"; break; } queue.Enqueue(line); } } finally { eof=true; } }); reader.IsBackground=true; reader.Start();
    try {
      while(!quitting) {
        MSG msg; while(PeekMessage(out msg,IntPtr.Zero,0,0,1)) { TranslateMessage(ref msg); DispatchMessage(ref msg); }
        string line;
        while(queue.TryDequeue(out line)) {
          string id=null;
          try { using(var doc=JsonDocument.Parse(line)) { var e=doc.RootElement; id=e.GetProperty("id").GetString(); object result=Command(e); Output(new{id=id,ok=true,result=result}); } }
          catch(Exception ex) { string error=ex.Message; try { RestoreAll(); } catch(Exception restore) { error+="; restore: "+restore.Message; } Output(new{id=id,ok=false,error=error}); }
        }
        if(deferredError!=null) throw new Exception(deferredError);
        if(eof) break;
        if((target!=null||parked.Count>0)&&Now()-beat>8000) { object restored=RestoreAll(); Output(new{ @event="released",reason="heartbeat-timeout",result=restored }); }
        if(dirty&&target!=null) { dirty=false; try { Apply(); } catch(Exception ex) { string error=ex.Message; try{RestoreAll();}catch(Exception restore){error+="; restore: "+restore.Message;} Output(new{@event="error",error=error}); } }
        Thread.Sleep(20);
      }
    } finally { try { RestoreAll(); } catch(Exception ex) { Console.Error.WriteLine("Restore failed: "+ex.Message); } ClearHooks(); }
  }
}
}
