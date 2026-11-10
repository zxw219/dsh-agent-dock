using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using Accessibility;

// Public Windows accessibility only. Never reads third-party files or protocols.
public static class WorkBuddyBridge {
    [DllImport("oleacc.dll")] static extern int AccessibleObjectFromWindow(IntPtr h, uint id, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out IAccessible a);
    [DllImport("oleacc.dll")] static extern int AccessibleChildren(IAccessible a, int start, int count, [Out, MarshalAs(UnmanagedType.LPArray, SizeParamIndex=2)] object[] children, out int obtained);
    delegate bool WindowCallback(IntPtr h, IntPtr p);
    [DllImport("user32.dll")] static extern bool EnumWindows(WindowCallback cb, IntPtr p);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder b, int n);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder b, int n);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] static extern bool GetCursorPos(out Point p);
    [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(Point p);
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint flags);
    [DllImport("user32.dll")] static extern void mouse_event(uint flags, uint x, uint y, uint data, UIntPtr extra);
    [StructLayout(LayoutKind.Sequential)] struct Point { public int X,Y; }
    [StructLayout(LayoutKind.Sequential)] struct Rect { public int L,T,R,B; }
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out Rect r);
    [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr h, int flags, StringBuilder b, ref int size);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
    [DllImport("user32.dll", SetLastError=true)] static extern IntPtr SendMessageTimeout(IntPtr h, uint msg, UIntPtr w, IntPtr l, uint flags, uint timeout, out UIntPtr result);
    class Node { public IAccessible A; public int Role,X,Y,W,H; public string Name; }
    class Entry { public Node Row; public string Group,Title,Key; }
    class Snapshot { public IntPtr Window; public List<Entry> Entries; }
    static Node Read(IAccessible a, bool name) {
        int x,y,w,h; a.accLocation(out x,out y,out w,out h,0);
        return new Node { A=a, Role=Convert.ToInt32(a.get_accRole(0)), X=x,Y=y,W=w,H=h,Name=name?(a.get_accName(0)??""):"" };
    }
    static List<IAccessible> Children(IAccessible a) {
        int count=Math.Min(a.accChildCount,300); var list=new List<IAccessible>();
        if(count<=0) return list;
        var cs=new object[count]; int got; AccessibleChildren(a,0,count,cs,out got);
        for(int i=0;i<got;i++) { var c=cs[i] as IAccessible; if(c!=null) list.Add(c); }
        return list;
    }
    static bool Executable(IntPtr h) {
        uint pid; GetWindowThreadProcessId(h,out pid); IntPtr p=OpenProcess(0x1000,false,pid);
        if(p==IntPtr.Zero) return false;
        try { var b=new StringBuilder(32768); int n=b.Capacity; return QueryFullProcessImageName(p,0,b,ref n)&&string.Equals(Path.GetFileName(b.ToString()),"WorkBuddy.exe",StringComparison.OrdinalIgnoreCase); }
        finally { CloseHandle(p); }
    }
    static IntPtr MainWindow() {
        var found=new List<IntPtr>();
        EnumWindows((h,p)=>{var b=new StringBuilder(128); GetWindowText(h,b,b.Capacity); if(b.ToString()=="WorkBuddy"&&IsWindowVisible(h)&&Executable(h)) found.Add(h); return true;},IntPtr.Zero);
        var sidebars=new List<IntPtr>();
        foreach(var candidate in found) {
            if(IsIconic(candidate)) continue;
            try { int budget=4000; if(Tabs(Root(candidate),0,ref budget)!=null) sidebars.Add(candidate); } catch(COMException) {} catch(Exception) {}
        }
        if(sidebars.Count!=1) throw new Exception("需要一个带有侧栏的 WorkBuddy 主窗口；当前识别到 "+sidebars.Count+" 个。请还原目标版本主窗口；若两个版本都有侧栏，请暂时最小化另一个版本后刷新。");
        return sidebars[0];
    }
    static IAccessible Root(IntPtr h) {
        UIntPtr ignored; SendMessageTimeout(h,0x003D,UIntPtr.Zero,new IntPtr(-4),2,1500,out ignored);
        IAccessible a; Guid g=new Guid("618736e0-3c3d-11cf-810c-00aa00389b71");
        int hr=AccessibleObjectFromWindow(h,0xFFFFFFFC,ref g,out a);
        if(hr!=0||a==null) throw new Exception("无法读取 WorkBuddy 辅助功能界面："+hr);
        return a;
    }
    static Node Tabs(IAccessible a,int depth,ref int budget) {
        if(depth>32||--budget<0) return null;
        try { var n=Read(a,true); if(n.Role==60&&n.Name=="Agents tabs"&&n.W>100&&n.H>0) return n;
            foreach(var c in Children(a)) { var r=Tabs(c,depth+1,ref budget); if(r!=null) return r; }
        } catch(COMException) {} return null;
    }
    static void Collect(IAccessible a,Node tabs,Rect bounds,int depth,ref int budget,List<Node> rows,List<Node> labels) {
        if(depth>32||--budget<0) return;
        try {
            var n=Read(a,false);
            if(n.W>0&&(n.X>=tabs.X+tabs.W||n.X+n.W<=tabs.X)) return;
            if(n.Y>=tabs.Y+tabs.H&&n.Y+n.H<=bounds.B&&n.H>0&&n.X>=tabs.X&&n.X<tabs.X+tabs.W) {
                if(n.Role==43&&Math.Abs(n.X-tabs.X)<=3&&Math.Abs(n.W-tabs.W)<=4&&n.H>=26&&n.H<=48) { rows.Add(n); return; }
                if(n.Role==41&&n.H<=25) { n.Name=a.get_accName(0)??""; if(n.Name.Length>0&&n.Name.Length<150) labels.Add(n); }
            }
            foreach(var c in Children(a)) Collect(c,tabs,bounds,depth+1,ref budget,rows,labels);
        } catch(COMException) {}
    }
    static string FindTitle(IAccessible a,Node row,int depth) {
        if(depth>5) return null;
        foreach(var c in Children(a)) try {
            var n=Read(c,true);
            if(n.Role==41&&n.Name.Length>0&&n.Y>=row.Y&&n.Y<row.Y+row.H&&n.X<row.X+row.W*0.7) return n.Name;
            var title=FindTitle(c,row,depth+1); if(title!=null) return title;
        } catch(COMException) {} return null;
    }
    static Snapshot Capture() {
        IntPtr h=MainWindow(); var root=Root(h); int budget=4000; var tabs=Tabs(root,0,ref budget);
        if(tabs==null) throw new Exception("未找到 WorkBuddy 侧栏。请展开侧栏后刷新。");
        var rows=new List<Node>(); var labels=new List<Node>(); budget=6000;
        Rect bounds; if(!GetWindowRect(h,out bounds)) throw new Exception("无法确认 WorkBuddy 窗口边界。");
        Collect(root,tabs,bounds,0,ref budget,rows,labels);
        if(budget<=0) throw new Exception("辅助功能列表超出读取上限。");
        rows.Sort((a,b)=>a.Y.CompareTo(b.Y)); labels.Sort((a,b)=>a.Y.CompareTo(b.Y));
        var entries=new List<Entry>(); var seen=new HashSet<string>();
        foreach(var row in rows) {
            string group="任务";
            foreach(var label in labels) { if(label.Y>=row.Y) break; if(label.X>=tabs.X+30&&label.X<tabs.X+50&&label.Name!="空间"&&!label.Name.StartsWith("空间 (")) group=label.Name; }
            string title=FindTitle(row.A,row,0);
            if(title==null) throw new Exception("无法确认某个侧栏条目的标题，请重新展开列表。");
            string key=Convert.ToBase64String(Encoding.UTF8.GetBytes(group+"\n"+title)); int ordinal=0;
            while(!seen.Add(key+":"+ordinal)) ordinal++;
            entries.Add(new Entry {Row=row,Group=group,Title=title,Key=key+":"+ordinal});
        }
        return new Snapshot { Window=h,Entries=entries };
    }
    public static object Sidebar() {
        var snapshot=Capture(); var groups=new List<object>(); List<object> items=null; string group=null;
        foreach(var entry in snapshot.Entries) {
            if(group!=entry.Group) { group=entry.Group; items=new List<object>(); groups.Add(new {name=group,conversations=items}); }
            items.Add(new {key=entry.Key,title=entry.Title});
        }
        return new {ok=true,connected=true,window=snapshot.Window.ToString(),scope="visible-sidebar",groups=groups,fetchedAt=DateTime.UtcNow.ToString("o")};
    }
    static IAccessible FindMenu(IAccessible a,int depth,ref int budget) {
        if(depth>32||--budget<0) return null;
        try { var n=Read(a,false); if(n.Role==12&&n.W>0&&n.H>0&&a.get_accName(0)=="在独立窗口中打开") return a;
            foreach(var c in Children(a)) { var r=FindMenu(c,depth+1,ref budget); if(r!=null) return r; }
        } catch(COMException) {} return null;
    }
    static bool HeaderMatches(IAccessible a,Rect bounds,string title,int depth,ref int budget) {
        if(depth>28||--budget<0) return false;
        try {
            var n=Read(a,false);
            // Never read the chat body: inspect names only for small top-header text.
            if(n.W>0&&n.H>0&&(n.Y>=bounds.T+140||n.Y+n.H<=bounds.T)) return false;
            if((n.Role==41||n.Role==42)&&n.H>0&&n.H<=48&&n.Y>=bounds.T&&n.Y+n.H<=bounds.T+140&&a.get_accName(0)==title) return true;
            foreach(var c in Children(a)) if(HeaderMatches(c,bounds,title,depth+1,ref budget)) return true;
        } catch(COMException) {} return false;
    }
    static List<IntPtr> Popups(IntPtr main,string title) {
        var found=new List<IntPtr>();
        EnumWindows((h,p)=>{
            if(h==main||!IsWindowVisible(h)||IsIconic(h)||!Executable(h)) return true;
            var cls=new StringBuilder(128); GetClassName(h,cls,cls.Capacity);
            if(!cls.ToString().StartsWith("Chrome_WidgetWin_")) return true;
            Rect bounds; if(!GetWindowRect(h,out bounds)||bounds.R-bounds.L<300||bounds.B-bounds.T<200) return true;
            try { int budget=2500; if(HeaderMatches(Root(h),bounds,title,0,ref budget)) found.Add(h); } catch(COMException) {}
            return true;
        },IntPtr.Zero);
        return found;
    }
    public static object Open(string expectedWindow,string key,string group,string title) {
        var snapshot=Capture();
        if(snapshot.Window.ToString()!=expectedWindow) throw new Exception("WorkBuddy 主窗口已改变，请刷新真实列表。");
        Entry chosen=null; int sameTitle=0;
        foreach(var e in snapshot.Entries) { if(e.Title==title) sameTitle++; if(e.Key==key&&e.Group==group&&e.Title==title) chosen=e; }
        if(chosen==null) throw new Exception("列表已变化或条目已不可见，请刷新真实列表。");
        // Popup headers expose a title but no documented stable conversation ID.
        if(sameTitle!=1) throw new Exception("当前展开列表存在同名对话，无法可靠核对小窗归属。请在 WorkBuddy 中直接打开。");
        SetForegroundWindow(snapshot.Window);
        for(int focusWait=0;focusWait<10&&GetForegroundWindow()!=snapshot.Window;focusWait++) Thread.Sleep(30);
        if(GetForegroundWindow()!=snapshot.Window) throw new Exception("无法确认 WorkBuddy 前台焦点，未发送点击。");
        var row=Read(chosen.Row.A,false); var point=new Point {X=row.X+Math.Min(row.W/2,100),Y=row.Y+row.H/2};
        if(row.W<=0||row.H<=0||GetAncestor(WindowFromPoint(point),2)!=snapshot.Window) throw new Exception("目标条目被遮挡，未发送点击。");
        Point old; bool restore=GetCursorPos(out old);
        if(!SetCursorPos(point.X,point.Y)) throw new Exception("无法定位目标条目。");
        try {
            if(GetForegroundWindow()!=snapshot.Window) throw new Exception("前台窗口已改变，未发送点击。");
            mouse_event(8,0,0,0,UIntPtr.Zero); mouse_event(16,0,0,0,UIntPtr.Zero);
            IAccessible menu=null;
            for(int i=0;i<15;i++) { int budget=6000; menu=FindMenu(Root(snapshot.Window),0,ref budget); if(menu!=null) break; Thread.Sleep(100); }
            if(menu==null) throw new Exception("未找到原生“在独立窗口中打开”菜单，请在原软件检查。");
            if(GetForegroundWindow()!=snapshot.Window) throw new Exception("前台窗口已改变，未执行菜单。");
            menu.accDoDefaultAction(0);
        } finally { Point current; if(restore&&GetCursorPos(out current)&&current.X==point.X&&current.Y==point.Y) SetCursorPos(old.X,old.Y); }
        for(int i=0;i<25;i++) {
            var popups=Popups(snapshot.Window,title);
            if(popups.Count>1) throw new Exception("发现多个同名对话小窗，未选择窗口。");
            if(popups.Count==1) { uint pid;GetWindowThreadProcessId(popups[0],out pid);var nativeTitle=new StringBuilder(2048); GetWindowText(popups[0],nativeTitle,nativeTitle.Capacity); return new {ok=true,window=popups[0].ToString(),pid=pid,title=title,windowTitle=nativeTitle.ToString()}; }
            Thread.Sleep(150);
        }
        throw new Exception("已执行原生菜单，但未能核对对应的小窗标题；不报告打开成功。");
    }
}
