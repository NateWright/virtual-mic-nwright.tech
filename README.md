# Virtual Mic for Gnome
## Description
Simple gnome extension that will create a virtual mic with `pactl load-module module-null-sink media.class=Audio/Source/Virtual sink_name=VirtualMic` and will let you choose an input application that will connect to the virtual mic through `pw-link`. This is useful when screen sharing on jitsi because they do not have a way to share linux audio.

### Attribution
Icon from [here](https://www.svgrepo.com/svg/522727/audio-playlist)