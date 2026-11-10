using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using Accessibility;

// Reads only sidebar metadata exposed by Windows MSAA. No app files or private APIs.
public static class WorkBuddyBridge {
 [DllImport("oleacc.dll")] static extern int AccessibleObjectFromWindow(IntPtr h,uint id,ref Guid iid,[MarshalAs(UnmanagedType.Interface)]out IAccessible a);
 [DllImport("oleacc.dll")] static extern int AccessibleChildren(IAccessible a,int start,int count,[Out,MarshalAs(UnmanagedType.LPArray,SizeParamIndex=2)]object[] children,out int obtained);
 delegate bool WindowCallback(IntPtr h,IntPtr p);
 [DllImport("user32.dll")] static extern bool EnumWindows(WindowCallback cb,IntPtr p);
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h,StringBuilder b,int n);
 [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
 [StructLayout(LayoutKind.Sequential)] struct Rect { public int L,T,R,B; }
 [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h,out Rect r);
 [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access,bool inherit,uint pid);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr h,int flags,StringBuilder b,ref int size);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
 class Node { public IAccessible A; public int Role,X,Y,W,H; public string Name; }
 static Node Read(IAccessible a,bool name) { int x,y,w,h;a.accLocation(out x,out y,out w,out h,0); return new Node{A=a,Role=Convert.ToInt32(a.get_accRole(0)),X=x,Y=y,W=w,H=h,Name=name?(a.get_accName(0)??""):""}; }
 static List<IAccessible> Children(IAccessible a) { int count=Math.Min(a.accChildCount,300);var list=new List<IAccessible>();if(count<=0)return list;var cs=new object[count];int got;AccessibleChildren(a,0,count,cs,out got);for(int i=0;i<got;i++){var c=cs[i] as IAccessible;if(c!=null)list.Add(c);}return list; }
 static bool Executable(IntPtr h) {uint pid;GetWindowThreadProcessId(h,out pid);IntPtr p=OpenProcess(0x1000,false,pid);if(p==IntPtr.Zero)return false;try{var b=new StringBuilder(32768);int n=b.Capacity;return QueryFullProcessImageName(p,0,b,ref n)&&string.Equals(Path.GetFileName(b.ToString()),"WorkBuddy.exe",StringComparison.OrdinalIgnoreCase);}finally{CloseHandle(p);} }
 static IntPtr MainWindow(){var found=new List<IntPtr>();EnumWindows((h,p)=>{var b=new StringBuilder(128);GetWindowText(h,b,b.Capacity);if(b.ToString()=="WorkBuddy"&&IsWindowVisible(h)&&Executable(h))found.Add(h);return true;},IntPtr.Zero);if(found.Count!=1)throw new Exception("需要一个可识别的 WorkBuddy 主窗口；当前找到 "+found.Count+" 个。请打开主窗口后刷新。");if(IsIconic(found[0]))throw new Exception("请先还原 WorkBuddy 主窗口，再刷新真实列表。");return found[0];}
 [DllImport("user32.dll",SetLastError=true)] static extern IntPtr SendMessageTimeout(IntPtr h,uint msg,UIntPtr w,IntPtr l,uint flags,uint timeout,out UIntPtr result);
 static IAccessible Root(IntPtr h){UIntPtr ignored;SendMessageTimeout(h,0x003D,UIntPtr.Zero,new IntPtr(-4),2,1500,out ignored);IAccessible a;Guid g=new Guid("618736e0-3c3d-11cf-810c-00aa00389b71");int hr=AccessibleObjectFromWindow(h,0xFFFFFFFC,ref g,out a);if(hr!=0||a==null)throw new Exception("无法读取 WorkBuddy 辅助功能界面："+hr);return a;}
 static Node Tabs(IAccessible a,int depth,ref int budget){if(depth>32||--budget<0)return null;try{var n=Read(a,true);if(n.Role==60&&n.Name=="Agents tabs"&&n.W>100&&n.H>0)return n;foreach(var c in Children(a)){var r=Tabs(c,depth+1,ref budget);if(r!=null)return r;}}catch(COMException){}return null;}
 static void Collect(IAccessible a,Node tabs,Rect bounds,int depth,ref int budget,List<Node> rows,List<Node> labels){if(depth>32||--budget<0)return;try{var n=Read(a,false);if(n.W>0&&(n.X>=tabs.X+tabs.W||n.X+n.W<=tabs.X))return;if(n.Y>=tabs.Y+tabs.H&&n.Y+n.H<=bounds.B&&n.H>0&&n.X>=tabs.X&&n.X<tabs.X+tabs.W){if(n.Role==43&&Math.Abs(n.X-tabs.X)<=3&&Math.Abs(n.W-tabs.W)<=4&&n.H>=26&&n.H<=48){n.Name=a.get_accName(0)??"";rows.Add(n);return;}if(n.Role==41&&n.H<=25){n.Name=a.get_accName(0)??"";if(n.Name.Length>0&&n.Name.Length<150)labels.Add(n);}}foreach(var c in Children(a))Collect(c,tabs,bounds,depth+1,ref budget,rows,labels);}catch(COMException){} }
 static string FindTitle(IAccessible a,Node row,int depth){if(depth>5)return null;foreach(var c in Children(a)){try{var n=Read(c,true);if(n.Role==41&&n.Name.Length>0&&n.Y>=row.Y&&n.Y<row.Y+row.H&&n.X<row.X+row.W*0.7)return n.Name;var title=FindTitle(c,row,depth+1);if(title!=null)return title;}catch(COMException){}}return null;}
 static string Title(Node row){var title=FindTitle(row.A,row,0);if(title!=null)return title;throw new Exception("无法确认某个侧栏条目的标题，请重新展开列表。");}
 public static object Sidebar(){IntPtr h=MainWindow();var root=Root(h);int budget=4000;var tabs=Tabs(root,0,ref budget);if(tabs==null)throw new Exception("未找到 WorkBuddy 侧栏。请展开侧栏后刷新。");var rows=new List<Node>();var labels=new List<Node>();budget=6000;Rect bounds;if(!GetWindowRect(h,out bounds))throw new Exception("无法确认 WorkBuddy 窗口边界。");Collect(root,tabs,bounds,0,ref budget,rows,labels);if(budget<=0)throw new Exception("辅助功能列表超出读取上限。");rows.Sort((a,b)=>a.Y.CompareTo(b.Y));labels.Sort((a,b)=>a.Y.CompareTo(b.Y));var groups=new List<object>();var items=new List<object>();string group="任务";groups.Add(new {name=group,conversations=items});var seen=new HashSet<string>();foreach(var row in rows){string rowGroup="任务";foreach(var label in labels){if(label.Y>=row.Y)break;if(label.X>=tabs.X+30&&label.X<tabs.X+50&&label.Name!="空间"&&!label.Name.StartsWith("空间 ("))rowGroup=label.Name;}if(group!=rowGroup){group=rowGroup;items=new List<object>();groups.Add(new{name=group,conversations=items});}string title=Title(row);string identity=group+"\n"+title;int ordinal=0;string key=Convert.ToBase64String(Encoding.UTF8.GetBytes(identity));while(!seen.Add(key+":"+ordinal))ordinal++;items.Add(new{key=key+":"+ordinal,title=title});}return new{ok=true,connected=true,window=h.ToString(),scope="visible-sidebar",groups=groups,fetchedAt=DateTime.UtcNow.ToString("o")};}
}
