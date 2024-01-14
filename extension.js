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
        _init(dir_path) {
            super._init(0.5, _('My Shiny Indicator'));

            this.add_child(new St.Icon({
                gicon: Gio.icon_new_for_string(dir_path + '/icon-audio.svg'),
                style_class: 'system-status-icon',
            }));
            this._activeApplication = null;
            this._applications = {};
            this._mixerControl = Volume.getMixerControl();
            this._sa_event_id = this._mixerControl.connect('stream-added', this._onStreamAdded.bind(this));
            this._sr_event_id = this._mixerControl.connect('stream-removed', this._onStreamRemoved.bind(this));
            this.menu.connect('open-state-changed', (menu, open) => {
                if (open) {
                    this.updateMenu();
                }
            });
            const menuItem = new PopupMenu.PopupMenuItem('Select Source');
            menuItem.active = false;
            menuItem.sensitive = false;
            this.menu.addMenuItem(menuItem);

            for (const stream of this._mixerControl.get_streams()) {
                this._onStreamAdded(this._mixerControl, stream);
            }
            this.updateMenu();
        }

        _onStreamAdded(control, id) {
            if (id in this._applications) {
                return;
            }

            const stream = control.lookup_stream_id(id);
            if (stream.is_event_stream || !(stream instanceof MixerSinkInput)) {
                return;
            }
            console.log('adding ' + id)
            console.log('app id:' + stream.index);
            const application = {
                id: id,
                name: stream.name,
                stream: stream,
                menuItem: new PopupMenu.PopupMenuItem(stream.name + ' ' + stream.description)
            }
            application.menuItem.connect('activate', (item, event) => this.itemClicked(item, event));
            this._applications[id] = application;
            this.menu.addMenuItem(application.menuItem);
        }
        _onStreamRemoved(control, id) {
            if (!(id in this._applications)) {
                return;
            }
            console.log('removing ' + id)

            const application = this._applications[id];
            this.menu.removeMenuItem(application.menuItem);
            delete this._applications[id];
        }
        updateMenu() {
            return;
            const getApplications = Gio.Subprocess.new(['pactl', '-f', 'json', 'list', 'sink-inputs'], Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
            getApplications.communicate_utf8_async(null, null, (proc1, res1) => {
                let [, applications, stderr] = getApplications.communicate_utf8_finish(res1);
                const applicationsJson = JSON.parse(applications);

                const active_audio = [];
                for (let application of applicationsJson) {
                    active_audio.push(application["properties"]["application.name"].trim());
                }
                for (let item of this.menu_items) {
                    if (!active_audio.includes(item) && item == this.last_connection) {
                        this.disconnect_audio();
                    }
                }
                this.menu_items = active_audio;
                this.menu.removeAll();
                const menuItem = new PopupMenu.PopupMenuItem('Select Source');
                menuItem.active = false;
                menuItem.sensitive = false;
                this.menu.addMenuItem(menuItem);
                for (let application of this.menu_items) {
                    const item = new PopupMenu.PopupMenuItem(application);
                    if (application == this.last_connection) {
                        item.setOrnament(PopupMenu.Ornament.CHECK);
                    }
                    item.connect('activate', (item, event) => this.itemClicked(item, event));
                    this.menu.addMenuItem(item);
                }
            });

        }

        itemClicked(item, event) {
            return;
            const last_connection = this.last_connection;
            this.disconnect_audio();
            if (item.label.text == last_connection) {
                return;
            }
            const connectProc = Gio.Subprocess.new(['pw-link', item.label.text, 'VirtualMic'], Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
            connectProc.communicate_utf8_async(null, null, (proc2, res2) => {
                item.setOrnament(PopupMenu.Ornament.CHECK);
                this.last_connection = item.label.text;
                let [, stdout, stderr] = connectProc.communicate_utf8_finish(res2);
                console.log(stdout);
            });
        }

        disconnect_audio() {
            return;
            if (!this.last_connection) {
                return;
            }
            const dis = Gio.Subprocess.new(['pw-link', '-d', this.last_connection, 'VirtualMic'], Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
            dis.wait(null);
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
        });
        this._indicator = new Indicator(this.path);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        const getSinkProc = Gio.Subprocess.new(['pactl', 'unload-module', this.virtMic], Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
        getSinkProc.wait(null);
        this._indicator.destroy();
        this._indicator = null;
    }
}
