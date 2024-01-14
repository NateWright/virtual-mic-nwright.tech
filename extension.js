/* extension.js
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import GObject from 'gi://GObject';
import St from 'gi://St';
import Gio from 'gi://Gio';
import Gvc from 'gi://Gvc';

import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Volume from 'resource:///org/gnome/shell/ui/status/volume.js';

const MixerSinkInput = Gvc.MixerSinkInput;

const Indicator = GObject.registerClass(
    class Indicator extends PanelMenu.Button {
        _init(dir_path, channels) {
            super._init(0.5, _('My Shiny Indicator'));

            this.add_child(new St.Icon({
                gicon: Gio.icon_new_for_string(dir_path + '/icon-audio.svg'),
                style_class: 'system-status-icon',
            }));
            this._channels = channels;
            this._activeApplication = null;
            this._applications = {};
            this._mixerControl = Volume.getMixerControl();
            this._sa_event_id = this._mixerControl.connect('stream-added', this._onStreamAdded.bind(this));
            this._sr_event_id = this._mixerControl.connect('stream-removed', this._onStreamRemoved.bind(this));
            // this.menu.connect('open-state-changed', (menu, open) => {
            //     if (open) {
            //         this.updateMenu();
            //     }
            // });
            const menuItem = new PopupMenu.PopupMenuItem('Select Source');
            menuItem.active = false;
            menuItem.sensitive = false;
            this.menu.addMenuItem(menuItem);

            for (const stream of this._mixerControl.get_streams()) {
                this._onStreamAdded(this._mixerControl, stream.id);
            }
            // this.updateMenu();
        }

        _onStreamAdded(control, id) {
            if (id in this._applications) {
                return;
            }
            const stream = control.lookup_stream_id(id);
            if (stream.is_event_stream || !(stream instanceof MixerSinkInput)) {
                return;
            }
            const application = {
                id: id,
                name: stream.name,
                stream: stream,
                menuItem: new PopupMenu.PopupMenuItem(stream.name + ': ' + stream.description),
                outputChannels: {},
            }
            const pwDump = Gio.Subprocess.new(['pw-dump'], Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
            pwDump.communicate_utf8_async(null, null, (proc1, res1) => {
                let [, stdout, stderr] = pwDump.communicate_utf8_finish(res1);
                const pwJson = JSON.parse(stdout);
                for (let i = 0; i < pwJson.length; i++) {
                    const pwNode = pwJson[i];
                    try {
                        if (pwNode["info"]["props"]["object.serial"] == stream.index) {
                            const id = pwNode["id"];
                            for (let j = i + 1; i < pwJson.length; j++) {
                                try {
                                    const pwNode2 = pwJson[j];
                                    if (pwNode2["info"]["props"]["node.id"] == id && pwNode2["info"]["props"]["port.direction"] == "out") {
                                        application.outputChannels[pwNode2["info"]["props"]["audio.channel"]] = pwNode2["id"];
                                    }
                                    if ("FL" in application.outputChannels && "FR" in application.outputChannels) {
                                        application.menuItem.connect('activate', (item, event) => {
                                            this.connect_audio(application.id);
                                        });
                                        break;
                                    }
                                } catch (e) {

                                }

                            }
                            break;
                        }
                    } catch (e) {

                    }

                }
                this._applications[id] = application;
                this.menu.addMenuItem(application.menuItem);
            });
        }
        _onStreamRemoved(control, id) {
            if (!(id in this._applications)) {
                return;
            }

            const application = this._applications[id];
            application.menuItem.destroy();
            delete this._applications[id];
        }

        connect_audio(id) {
            const last_connection = this.last_connection;
            this.disconnect_audio();
            if (id == last_connection) {
                return;
            }

            const connectFL = Gio.Subprocess.new(['pw-link', this._applications[id].outputChannels["FL"].toString(), this._channels["FL"].toString()], Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
            const connectFR = Gio.Subprocess.new(['pw-link', this._applications[id].outputChannels["FR"].toString(), this._channels["FR"].toString()], Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
            connectFL.communicate_utf8_async(null, null, (proc1, res1) => {
                let [, stdout, stderr] = connectFL.communicate_utf8_finish(res1);
                connectFR.communicate_utf8_async(null, null, (proc2, res2) => {
                    let [, stdout, stderr] = connectFR.communicate_utf8_finish(res2);
                    this.last_connection = id;
                    this._applications[id].menuItem.setOrnament(PopupMenu.Ornament.CHECK);
                });
            });
        }

        disconnect_audio() {
            if (!this.last_connection) {
                return;
            }
            this._applications[this.last_connection].menuItem.setOrnament(PopupMenu.Ornament.NONE);

            const disconnectFL = Gio.Subprocess.new(['pw-link', '-d', this._applications[this.last_connection].outputChannels["FL"].toString(), this._channels["FL"].toString()], Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
            const disconnectFR = Gio.Subprocess.new(['pw-link', '-d', this._applications[this.last_connection].outputChannels["FR"].toString(), this._channels["FR"].toString()], Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);

            this.last_connection = null;
        }

    });

export default class IndicatorExampleExtension extends Extension {
    enable() {
        const getSinkProc = Gio.Subprocess.new(['pactl', 'load-module', 'module-null-sink', 'media.class=Audio/Source/Virtual', 'sink_name=VirtualMic'], Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
        getSinkProc.communicate_utf8_async(null, null, (proc1, res1) => {
            let [, virtMic, stderr] = getSinkProc.communicate_utf8_finish(res1);
            virtMic = virtMic.trim();
            this.virtMic = virtMic;
            const pwDump = Gio.Subprocess.new(['pw-dump'], Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
            pwDump.communicate_utf8_async(null, null, (proc1, res1) => {
                let [, stdout, stderr] = pwDump.communicate_utf8_finish(res1);
                const pwJson = JSON.parse(stdout);
                const channels = {};
                for (let i = 0; i < pwJson.length; i++) {
                    const pwNode = pwJson[i];
                    try {
                        if (pwNode["info"]["props"]["pulse.module.id"] == virtMic) {
                            const id = pwNode["id"];
                            for (let j = i + 1; i < pwJson.length; j++) {
                                try {
                                    const pwNode2 = pwJson[j];
                                    if (pwNode2["info"]["props"]["node.id"] == id && pwNode2["info"]["props"]["port.direction"] == "in") {
                                        channels[pwNode2["info"]["props"]["audio.channel"]] = pwNode2["id"];
                                    }
                                    if ("FL" in channels && "FR" in channels) {
                                        break;
                                    }
                                }
                                catch (e) {

                                }

                            }
                            break;
                        }
                    } catch (e) {

                    }

                }
                this._indicator = new Indicator(this.path, channels);
                Main.panel.addToStatusArea(this.uuid, this._indicator);
            });
        });
    }

    disable() {
        const getSinkProc = Gio.Subprocess.new(['pactl', 'unload-module', this.virtMic], Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
        getSinkProc.wait(null);
        this._indicator.destroy();
        this._indicator = null;
    }
}
