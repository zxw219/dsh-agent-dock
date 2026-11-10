$ErrorActionPreference='Stop'
try {
Add-Type -ReferencedAssemblies Accessibility,System.Collections,System.Runtime,System.Runtime.InteropServices,System.Threading.Thread -IgnoreWarnings -WarningAction SilentlyContinue -TypeDefinition @'
using System;using System.Text;using System.Collections.Generic;using System.Runtime.InteropServices;using Accessibility;
public static class WorkBuddyShow {
 delegate bool Callback(IntPtr h,IntPtr p);
 [StructLayout(LayoutKind.Sequential)] public struct Rect{public int L,T,R,B;}
 [StructLayout(LayoutKind.Sequential)] struct Monitor{public int Size;public Rect Bounds,Work;public uint Flags;}
 [DllImport("user32.dll")] static extern bool EnumWindows(Callback c,IntPtr p);
 [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h,StringBuilder b,int n);
 [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint a,bool i,uint p);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr p,int f,StringBuilder b,ref int n);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr p);
 [DllImport("user32.dll")] static extern bool ShowWindowAsync(IntPtr h,int n);
 [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h,IntPtr a,int x,int y,int w,int height,uint f);
 [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h,out Rect r);
 [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h,uint flags);
 [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr h,ref Monitor m);
 [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);
 static bool Exe(IntPtr h){uint pid;GetWindowThreadProcessId(h,out pid);var p=OpenProcess(0x1000,false,pid);if(p==IntPtr.Zero)return false;try{var b=new StringBuilder(32768);int n=b.Capacity;return QueryFullProcessImageName(p,0,b,ref n)&&System.IO.Path.GetFileName(b.ToString()).Equals("WorkBuddy.exe",StringComparison.OrdinalIgnoreCase);}finally{CloseHandle(p);}}
 [DllImport("oleacc.dll")] static extern int AccessibleObjectFromWindow(IntPtr h,uint id,ref Guid iid,[MarshalAs(UnmanagedType.Interface)]out IAccessible a);
 [DllImport("oleacc.dll")] static extern int AccessibleChildren(IAccessible a,int start,int count,[Out,MarshalAs(UnmanagedType.LPArray,SizeParamIndex=2)]object[] c,out int n);
 static bool MainStructure(IAccessible a,int depth,ref int budget){if(depth>30||--budget<0)return false;try{int role=Convert.ToInt32(a.get_accRole(0));if(role==60&&a.get_accName(0)=="Agents tabs")return true;int count=Math.Min(a.accChildCount,150);if(count>0){var c=new object[count];int n;AccessibleChildren(a,0,count,c,out n);for(int i=0;i<n;i++){var child=c[i] as IAccessible;if(child!=null&&MainStructure(child,depth+1,ref budget))return true;}}}catch(COMException){}return false;}
 static bool IsMain(IntPtr h){try{Guid g=new Guid("618736e0-3c3d-11cf-810c-00aa00389b71");IAccessible a;int budget=2000;return AccessibleObjectFromWindow(h,0xFFFFFFFC,ref g,out a)==0&&a!=null&&MainStructure(a,0,ref budget);}catch{return false;}}
 public static object Show(){
 SetThreadDpiAwarenessContext(new IntPtr(-4));var found=new List<IntPtr>();
 EnumWindows((h,p)=>{var b=new StringBuilder(512);GetWindowText(h,b,b.Capacity);if(IsWindowVisible(h)&&b.ToString()=="WorkBuddy"&&Exe(h))found.Add(h);return true;},IntPtr.Zero);
 if(found.Count>1){var mains=found.FindAll(h=>IsMain(h));if(mains.Count==1)found=mains;else throw new Exception("发现多个 WorkBuddy 窗口，无法确认唯一主窗口。请关闭额外独立对话窗后重试。");}
 if(found.Count!=1)throw new Exception("请先手动启动并打开 WorkBuddy 主窗口。");
 var target=found[0];var monitor=new Monitor();monitor.Size=Marshal.SizeOf(monitor);if(!GetMonitorInfo(MonitorFromWindow(GetForegroundWindow(),2),ref monitor))throw new Exception("无法确认显示器可用区域。");
 var area=monitor.Work;int aw=area.R-area.L,ah=area.B-area.T;int w=Math.Min(1440,(int)(aw*0.88)),height=Math.Min(1000,(int)(ah*0.9));int x=area.L+(aw-w)/2,y=area.T+(ah-height)/2;
 ShowWindowAsync(target,9);for(int i=0;i<20&&IsIconic(target);i++)System.Threading.Thread.Sleep(50);
 if(!Exe(target)||IsIconic(target))throw new Exception("无法还原 WorkBuddy 窗口。");
 if(!SetWindowPos(target,IntPtr.Zero,x,y,w,height,0x210))throw new Exception("无法设置 WorkBuddy 窗口位置。");
 SetForegroundWindow(target);Rect actual;if(!GetWindowRect(target,out actual)||!IsWindowVisible(target))throw new Exception("无法确认 WorkBuddy 窗口已显示。");
 if(actual.L<area.L||actual.T<area.T||actual.R>area.R||actual.B>area.B)throw new Exception("WorkBuddy 最小尺寸超过当前显示器可用区域。");
 if(GetForegroundWindow()!=target)throw new Exception("窗口已还原，但 Windows 未允许切到前台，请点击任务栏 WorkBuddy。");
 return new{ok=true,window=target.ToInt64().ToString(),width=actual.R-actual.L,height=actual.B-actual.T};
 }
}
'@
[WorkBuddyShow]::Show() | ConvertTo-Json -Compress
}catch{ @{ok=$false;error=$_.Exception.GetBaseException().Message}|ConvertTo-Json -Compress;exit 1 }
