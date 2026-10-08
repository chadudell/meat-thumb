MEAT THUMB 0.3.0 — TESTER BUILD
================================

A synthesizer (Audio Unit instrument) for Logic Pro and GarageBand.
Needs macOS 12 or later. Runs natively on Apple Silicon and Intel Macs.


INSTALL
-------
1. Double-click MeatThumb-0.3.0.pkg.

2. macOS will probably say it "can't verify" the installer. This is a
   test build that isn't signed with an Apple developer certificate yet.
   To allow it:
     - Click Done (not Move to Trash).
     - Open System Settings > Privacy & Security.
     - Scroll down; next to "MeatThumb-0.3.0.pkg was blocked", click Open Anyway.
     - Confirm with your password or Touch ID.

3. Follow the installer. It puts Meat Thumb in
   /Library/Audio/Plug-Ins/Components.

4. Quit and reopen Logic Pro / GarageBand.


USE IT
------
New Software Instrument track > click the Instrument slot >
AU Instruments > Meat Thumb > Meat Thumb.

Not listed? Logic Pro > Settings > Plug-in Manager > select Meat Thumb >
Reset & Rescan Selection.


TIPS
----
- The thumb on the right reacts to the sound: push Sub, Cutoff, Resonance,
  Drive and Reverb and watch it change. Push them all for MAX MEAT.
- The sequencer's PLAY button arms it; it then starts and stops with
  Logic's transport (untick "follow host transport" to run it freely).
- If you hear crackles or Logic says it can't synchronize audio, set
  Logic Pro > Settings > Audio > I/O Buffer Size to 256.


REPORTING BUGS
--------------
Please send: your Mac model and macOS version, Logic or GarageBand version,
what you did, what happened, and a screenshot if it's visual.


UNINSTALL
---------
Delete /Library/Audio/Plug-Ins/Components/Meat Thumb.component
(in Finder: Go > Go to Folder... and paste the folder path).
