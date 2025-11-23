Ext.define('PVE.qemu.HardwareView', {
    extend: 'Proxmox.grid.PendingObjectGrid',
    alias: ['widget.PVE.qemu.HardwareView'],

    onlineHelp: 'qm_virtual_machines_settings',

    renderKey: function (key, metaData, rec, rowIndex, colIndex, store) {
        var me = this;
        var rows = me.rows;
        var rowdef = rows[key] || {};
        var iconCls = rowdef.iconCls;
        var icon = '';
        var txt = rowdef.header || key;

        metaData.tdAttr = 'valign=middle';

        if (rowdef.isOnStorageBus) {
            let value = me.getObjectValue(key, '', false);
            if (value === '') {
                value = me.getObjectValue(key, '', true);
            }
            if (value.match(/vm-.*-cloudinit/)) {
                iconCls = 'cloud';
                txt = rowdef.cloudheader;
            } else if (value.match(/media=cdrom/)) {
                metaData.tdCls = 'pve-itype-icon-cdrom';
                return rowdef.cdheader;
            }
        }

        if (rowdef.tdCls) {
            metaData.tdCls = rowdef.tdCls;
        } else if (iconCls) {
            icon = "<i class='pve-grid-fa fa fa-fw fa-" + iconCls + "'></i>";
            metaData.tdCls += ' pve-itype-fa';
        }

        // only return icons in grid but not remove dialog
        if (rowIndex !== undefined) {
            return icon + txt;
        } else {
            return txt;
        }
    },

    initComponent: function () {
        var me = this;

        const { node: nodename, vmid } = me.pveSelNode.data;
        if (!nodename) {
            throw 'no node name specified';
        } else if (!vmid) {
            throw 'no VM ID specified';
        }

        const caps = Ext.state.Manager.get('GuiCap');
        const diskCap = caps.vms['VM.Config.Disk'];
        const cdromCap = caps.vms['VM.Config.CDROM'];

        let isCloudInitKey = (v) => v && v.toString().match(/vm-.*-cloudinit/);

        const nodeInfo = PVE.data.ResourceStore.getNodes().find((node) => node.node === nodename);
        let processorEditor = {
            xtype: 'pveQemuProcessorEdit',
            cgroupMode: nodeInfo['cgroup-mode'],
        };

        let rows = {
            memory: {
                header: gettext('Memory'),
                editor: caps.vms['VM.Config.Memory'] ? 'PVE.qemu.MemoryEdit' : undefined,
                never_delete: true,
                defaultValue: '512',
                tdCls: 'pve-itype-icon-memory',
                group: 2,
                multiKey: ['memory', 'balloon', 'shares', 'allow-ksm'],
                renderer: function (value, metaData, record, ri, ci, store, pending) {
                    var res = '';

                    var max = me.getObjectValue('memory', 512, pending);
                    var balloon = me.getObjectValue('balloon', undefined, pending);
                    var shares = me.getObjectValue('shares', undefined, pending);

                    res = Proxmox.Utils.format_size(max * 1024 * 1024);

                    if (balloon !== undefined && balloon > 0) {
                        res = Proxmox.Utils.format_size(balloon * 1024 * 1024) + '/' + res;

                        if (shares) {
                            res += ' [shares=' + shares + ']';
                        }
                    } else if (balloon === 0) {
                        res += ' [balloon=0]';
                    }

                    let allowKsm = me.getObjectValue('allow-ksm', undefined, pending);
                    if (allowKsm !== undefined) {
                        res += ' [allow-ksm=' + allowKsm + ']';
                    }

                    return res;
                },
            },
            sockets: {
                header: gettext('Processors'),
                never_delete: true,
                editor:
                    caps.vms['VM.Config.CPU'] || caps.vms['VM.Config.HWType']
                        ? processorEditor
                        : undefined,
                tdCls: 'pve-itype-icon-cpu',
                group: 3,
                defaultValue: '1',
                multiKey: [
                    'sockets',
                    'cpu',
                    'cores',
                    'numa',
                    'vcpus',
                    'cpulimit',
                    'cpuunits',
                    'affinity',
                ],
                renderer: function (value, metaData, record, rowIndex, colIndex, store, pending) {
                    var sockets = me.getObjectValue('sockets', 1, pending);
                    var model = me.getObjectValue('cpu', undefined, pending);
                    var cores = me.getObjectValue('cores', 1, pending);
                    var numa = me.getObjectValue('numa', undefined, pending);
                    var vcpus = me.getObjectValue('vcpus', undefined, pending);
                    var cpulimit = me.getObjectValue('cpulimit', undefined, pending);
                    var cpuunits = me.getObjectValue('cpuunits', undefined, pending);
                    var cpuaffinity = me.getObjectValue('affinity', undefined, pending);

                    let res = Ext.String.format(
                        '{0} ({1} sockets, {2} cores)',
                        sockets * cores,
                        sockets,
                        cores,
                    );

                    if (model) {
                        res += ' [' + model + ']';
                    }
                    if (numa) {
                        res += ' [numa=' + numa + ']';
                    }
                    if (vcpus) {
                        res += ' [vcpus=' + vcpus + ']';
                    }
                    if (cpulimit) {
                        res += ' [cpulimit=' + cpulimit + ']';
                    }
                    if (cpuunits) {
                        res += ' [cpuunits=' + cpuunits + ']';
                    }
                    if (cpuaffinity) {
                        res += ' [cpuaffinity=' + cpuaffinity + ']';
                    }

                    return res;
                },
            },
            bios: {
                header: 'BIOS',
                group: 4,
                never_delete: true,
                editor: caps.vms['VM.Config.Options'] ? 'PVE.qemu.BiosEdit' : undefined,
                defaultValue: '',
                iconCls: 'microchip',
                renderer: PVE.Utils.render_qemu_bios,
            },
            vga: {
                header: gettext('Display'),
                editor: caps.vms['VM.Config.HWType'] ? 'PVE.qemu.DisplayEdit' : undefined,
                never_delete: true,
                iconCls: 'desktop',
                group: 5,
                defaultValue: '',
                renderer: PVE.Utils.render_kvm_vga_driver,
            },
            machine: {
                header: gettext('Machine'),
                editor: caps.vms['VM.Config.HWType'] ? 'PVE.qemu.MachineEdit' : undefined,
                iconCls: 'cogs',
                never_delete: true,
                group: 6,
                defaultValue: '',
                renderer: function (value, metaData, record, rowIndex, colIndex, store, pending) {
                    let ostype = me.getObjectValue('ostype', undefined, pending);
                    if (
                        PVE.Utils.is_windows(ostype) &&
                        (!value || value === 'pc' || value === 'q35')
                    ) {
                        return value === 'q35' ? 'pc-q35-5.1' : 'pc-i440fx-5.1';
                    }
                    return PVE.Utils.render_qemu_machine(value);
                },
            },
            scsihw: {
                header: gettext('SCSI Controller'),
                iconCls: 'database',
                editor: caps.vms['VM.Config.Options'] ? 'PVE.qemu.ScsiHwEdit' : undefined,
                renderer: PVE.Utils.render_scsihw,
                group: 7,
                never_delete: true,
                defaultValue: '',
            },
            vmstate: {
                header: gettext('Hibernation VM State'),
                iconCls: 'download',
                del_extra_msg: gettext('The saved VM state will be permanently lost.'),
                group: 100,
            },
            cores: {
                visible: false,
            },
            cpu: {
                visible: false,
            },
            numa: {
                visible: false,
            },
            'allow-ksm': {
                visible: false,
            },
            balloon: {
                visible: false,
            },
            hotplug: {
                visible: false,
            },
            vcpus: {
                visible: false,
            },
            cpuunits: {
                visible: false,
            },
            cpulimit: {
                visible: false,
            },
            shares: {
                visible: false,
            },
            ostype: {
                visible: false,
            },
            affinity: {
                visible: false,
            },
        };

        PVE.Utils.forEachBus(undefined, function (type, id) {
            let confid = type + id;
            rows[confid] = {
                group: 10,
                iconCls: 'hdd-o',
                editor: 'PVE.qemu.HDEdit',
                isOnStorageBus: true,
                header: gettext('Hard Disk') + ' (' + confid + ')',
                cdheader: gettext('CD/DVD Drive') + ' (' + confid + ')',
                cloudheader: gettext('CloudInit Drive') + ' (' + confid + ')',
                renderer: Ext.htmlEncode,
            };
        });
        for (let i = 0; i < PVE.Utils.hardware_counts.net; i++) {
            let confid = 'net' + i.toString();
            rows[confid] = {
                group: 15,
                order: i,
                iconCls: 'exchange',
                editor: caps.vms['VM.Config.Network'] ? 'PVE.qemu.NetworkEdit' : undefined,
                never_delete: !caps.vms['VM.Config.Network'],
                header: gettext('Network Device') + ' (' + confid + ')',
            };
        }
        rows.efidisk0 = {
            group: 20,
            iconCls: 'hdd-o',
            editor: null,
            never_delete: !caps.vms['VM.Config.Disk'],
            header: gettext('EFI Disk'),
            renderer: Ext.htmlEncode,
        };
        rows.tpmstate0 = {
            group: 22,
            iconCls: 'hdd-o',
            editor: null,
            never_delete: !caps.vms['VM.Config.Disk'],
            header: gettext('TPM State'),
            renderer: Ext.htmlEncode,
        };
        for (let i = 0; i < PVE.Utils.hardware_counts.usb; i++) {
            let confid = 'usb' + i.toString();
            rows[confid] = {
                group: 25,
                order: i,
                iconCls: 'usb',
                editor:
                    caps.nodes['Sys.Console'] || caps.mapping['Mapping.Use']
                        ? 'PVE.qemu.USBEdit'
                        : undefined,
                never_delete: !caps.nodes['Sys.Console'] && !caps.mapping['Mapping.Use'],
                header: gettext('USB Device') + ' (' + confid + ')',
            };
        }
        for (let i = 0; i < PVE.Utils.hardware_counts.hostpci; i++) {
            let confid = 'hostpci' + i.toString();
            rows[confid] = {
                group: 30,
                order: i,
                tdCls: 'pve-itype-icon-pci',
                never_delete: !caps.nodes['Sys.Console'] && !caps.mapping['Mapping.Use'],
                editor:
                    caps.nodes['Sys.Console'] || caps.mapping['Mapping.Use']
                        ? 'PVE.qemu.PCIEdit'
                        : undefined,
                header: gettext('PCI Device') + ' (' + confid + ')',
            };
        }
        for (let i = 0; i < PVE.Utils.hardware_counts.serial; i++) {
            let confid = 'serial' + i.toString();
            rows[confid] = {
                group: 35,
                order: i,
                tdCls: 'pve-itype-icon-serial',
                never_delete: !caps.nodes['Sys.Console'],
                header: gettext('Serial Port') + ' (' + confid + ')',
            };
        }
        rows.audio0 = {
            group: 40,
            iconCls: 'volume-up',
            editor: caps.vms['VM.Config.HWType'] ? 'PVE.qemu.AudioEdit' : undefined,
            never_delete: !caps.vms['VM.Config.HWType'],
            header: gettext('Audio Device'),
        };
        for (let i = 0; i < 256; i++) {
            rows['unused' + i.toString()] = {
                group: 99,
                order: i,
                iconCls: 'hdd-o',
                del_extra_msg: gettext('This will permanently erase all data.'),
                editor: caps.vms['VM.Config.Disk'] ? 'PVE.qemu.HDEdit' : undefined,
                header: gettext('Unused Disk') + ' ' + i.toString(),
                renderer: Ext.htmlEncode,
            };
        }
        rows.rng0 = {
            group: 45,
            tdCls: 'pve-itype-icon-die',
            editor:
                caps.vms['VM.Config.HWType'] || caps.mapping['Mapping.Use']
                    ? 'PVE.qemu.RNGEdit'
                    : undefined,
            never_delete: !caps.vms['VM.Config.HWType'] && !caps.mapping['Mapping.Use'],
            header: gettext('VirtIO RNG'),
        };
        for (let i = 0; i < PVE.Utils.hardware_counts.virtiofs; i++) {
            let confid = 'virtiofs' + i.toString();
            rows[confid] = {
                group: 50,
                order: i,
                iconCls: 'folder',
                editor: 'PVE.qemu.VirtiofsEdit',
                header: gettext('Virtiofs') + ' (' + confid + ')',
            };
        }

        var sorterFn = function (rec1, rec2) {
            var v1 = rec1.data.key;
            var v2 = rec2.data.key;
            var g1 = rows[v1].group || 0;
            var g2 = rows[v2].group || 0;
            var order1 = rows[v1].order || 0;
            var order2 = rows[v2].order || 0;

            if (g1 - g2 !== 0) {
                return g1 - g2;
            }

            if (order1 - order2 !== 0) {
                return order1 - order2;
            }

            if (v1 > v2) {
                return 1;
            } else if (v1 < v2) {
                return -1;
            } else {
                return 0;
            }
        };

        let baseurl = `nodes/${nodename}/qemu/${vmid}/config`;

        let sm = Ext.create('Ext.selection.RowModel', {});

        let run_editor = function () {
            let rec = sm.getSelection()[0];
            if (!rec || !rows[rec.data.key]?.editor) {
                return;
            }
            let rowdef = rows[rec.data.key];
            let editor = rowdef.editor;

            if (rowdef.isOnStorageBus) {
                let value = me.getObjectValue(rec.data.key, '', true);
                if (isCloudInitKey(value)) {
                    return;
                } else if (value.match(/media=cdrom/)) {
                    editor = 'PVE.qemu.CDEdit';
                } else if (!diskCap) {
                    return;
                }
            }

            let commonOpts = {
                autoShow: true,
                pveSelNode: me.pveSelNode,
                confid: rec.data.key,
                url: `/api2/extjs/${baseurl}`,
                listeners: {
                    destroy: () => me.reload(),
                },
            };

            if (Ext.isString(editor)) {
                Ext.create(editor, commonOpts);
            } else {
                let win = Ext.createWidget(
                    rowdef.editor.xtype,
                    Ext.apply(commonOpts, rowdef.editor),
                );
                win.load();
            }
        };

        let edit_btn = new Proxmox.button.Button({
            text: gettext('Edit'),
            selModel: sm,
            disabled: true,
            handler: run_editor,
        });

        let move_menuitem = new Ext.menu.Item({
            text: gettext('Move Storage'),
            tooltip: gettext('Move disk to another storage'),
            iconCls: 'fa fa-database',
            selModel: sm,
            handler: () => {
                let rec = sm.getSelection()[0];
                if (!rec) {
                    return;
                }
                Ext.create('PVE.window.HDMove', {
                    autoShow: true,
                    disk: rec.data.key,
                    nodename: nodename,
                    vmid: vmid,
                    type: 'qemu',
                    listeners: {
                        destroy: () => me.reload(),
                    },
                });
            },
        });

        let reassign_menuitem = new Ext.menu.Item({
            text: gettext('Reassign Owner'),
            tooltip: gettext('Reassign disk to another VM'),
            iconCls: 'fa fa-desktop',
            selModel: sm,
            handler: () => {
                let rec = sm.getSelection()[0];
                if (!rec) {
                    return;
                }

                Ext.create('PVE.window.GuestDiskReassign', {
                    autoShow: true,
                    disk: rec.data.key,
                    nodename: nodename,
                    vmid: vmid,
                    type: 'qemu',
                    listeners: {
                        destroy: () => me.reload(),
                    },
                });
            },
        });

        let resize_menuitem = new Ext.menu.Item({
            text: gettext('Resize'),
            iconCls: 'fa fa-plus',
            selModel: sm,
            handler: () => {
                let rec = sm.getSelection()[0];
                if (!rec) {
                    return;
                }
                Ext.create('PVE.window.HDResize', {
                    autoShow: true,
                    disk: rec.data.key,
                    nodename: nodename,
                    vmid: vmid,
                    listeners: {
                        destroy: () => me.reload(),
                    },
                });
            },
        });

        let diskaction_btn = new Proxmox.button.Button({
            text: gettext('Disk Action'),
            disabled: true,
            menu: {
                items: [move_menuitem, reassign_menuitem, resize_menuitem],
            },
        });

        let remove_btn = new Proxmox.button.Button({
            text: gettext('Remove'),
            defaultText: gettext('Remove'),
            altText: gettext('Detach'),
            selModel: sm,
            disabled: true,
            dangerous: true,
            RESTMethod: 'PUT',
            confirmMsg: function (rec) {
                let warn = gettext('Are you sure you want to remove entry {0}');
                if (this.text === this.altText) {
                    warn = gettext('Are you sure you want to detach entry {0}');
                }
                let rendered = me.renderKey(rec.data.key, {}, rec);
                let msg = Ext.String.format(warn, `'${rendered}'`);

                if (rows[rec.data.key].del_extra_msg) {
                    msg += '<br>' + rows[rec.data.key].del_extra_msg;
                }
                return msg;
            },
            handler: function (btn, e, rec) {
                let params = { delete: rec.data.key };
                if (btn.RESTMethod === 'POST') {
                    params.background_delay = 5;
                }
                Proxmox.Utils.API2Request({
                    url: '/api2/extjs/' + baseurl,
                    waitMsgTarget: me,
                    method: btn.RESTMethod,
                    params: params,
                    callback: () => me.reload(),
                    failure: (response) => Ext.Msg.alert('Error', response.htmlStatus),
                    success: function (response, options) {
                        if (btn.RESTMethod === 'POST' && response.result.data !== null) {
                            Ext.create('Proxmox.window.TaskProgress', {
                                autoShow: true,
                                upid: response.result.data,
                                listeners: {
                                    destroy: () => me.reload(),
                                },
                            });
                        }
                    },
                });
            },
            listeners: {
                render: function (btn) {
                    // hack: calculate the max button width on first display to prevent the whole
                    // toolbar to move when we switch between the "Remove" and "Detach" labels
                    var def = btn.getSize().width;

                    btn.setText(btn.altText);
                    var alt = btn.getSize().width;

                    btn.setText(btn.defaultText);

                    var optimal = alt > def ? alt : def;
                    btn.setSize({ width: optimal });
                },
            },
        });

        let revert_btn = new PVE.button.PendingRevert({
            apiurl: '/api2/extjs/' + baseurl,
        });

        let efidisk_menuitem = Ext.create('Ext.menu.Item', {
            text: gettext('EFI Disk'),
            iconCls: 'fa fa-fw fa-hdd-o black',
            disabled: !caps.vms['VM.Config.Disk'],
            handler: function () {
                let { data: bios } = me.rstore.getData().map.bios || {};

                Ext.create('PVE.qemu.EFIDiskEdit', {
                    autoShow: true,
                    url: '/api2/extjs/' + baseurl,
                    pveSelNode: me.pveSelNode,
                    usesEFI: bios?.value === 'ovmf' || bios?.pending === 'ovmf',
                    listeners: {
                        destroy: () => me.reload(),
                    },
                });
            },
        });

        let counts = {};
        let isAtLimit = (type) => counts[type] >= PVE.Utils.hardware_counts[type];
        let isAtUsbLimit = () => {
            let ostype = me.getObjectValue('ostype');
            let machine = me.getObjectValue('machine');
            return counts.usb >= PVE.Utils.get_max_usb_count(ostype, machine);
        };

        let set_button_status = function () {
            let selection_model = me.getSelectionModel();
            let rec = selection_model.getSelection()[0];

            counts = {}; // en/disable hardwarebuttons
            let hasCloudInit = false;
            me.rstore.getData().items.forEach(function ({ id, data }) {
                if (!hasCloudInit && (isCloudInitKey(data.value) || isCloudInitKey(data.pending))) {
                    hasCloudInit = true;
                    return;
                }

                let match = id.match(/^([^\d]+)\d+$/);
                if (match && PVE.Utils.hardware_counts[match[1]] !== undefined) {
                    let type = match[1];
                    counts[type] = (counts[type] || 0) + 1;
                }
            });

            // heuristic only for disabling some stuff, the backend has the final word.
            const noVMConfigHWTypePerm = !caps.vms['VM.Config.HWType'];
            const noVMConfigNetPerm = !caps.vms['VM.Config.Network'];
            const noVMConfigDiskPerm = !caps.vms['VM.Config.Disk'];
            const noVMConfigCDROMPerm = !caps.vms['VM.Config.CDROM'];
            const noVMConfigCloudinitPerm = !caps.vms['VM.Config.Cloudinit'];
            const noVMConfigOptionsPerm = !caps.vms['VM.Config.Options'];

            me.down('#addUsb').setDisabled(noVMConfigHWTypePerm || isAtUsbLimit());
            me.down('#addPci').setDisabled(noVMConfigHWTypePerm || isAtLimit('hostpci'));
            me.down('#addAudio').setDisabled(noVMConfigHWTypePerm || isAtLimit('audio'));
            me.down('#addSerial').setDisabled(noVMConfigHWTypePerm || isAtLimit('serial'));
            me.down('#addNet').setDisabled(noVMConfigNetPerm || isAtLimit('net'));
            me.down('#addRng').setDisabled(noVMConfigHWTypePerm || isAtLimit('rng'));
            efidisk_menuitem.setDisabled(noVMConfigDiskPerm || isAtLimit('efidisk'));
            me.down('#addTpmState').setDisabled(noVMConfigDiskPerm || isAtLimit('tpmstate'));
            me.down('#addVirtiofs').setDisabled(noVMConfigOptionsPerm || isAtLimit('virtiofs'));
            me.down('#addCloudinitDrive').setDisabled(
                noVMConfigCDROMPerm || noVMConfigCloudinitPerm || hasCloudInit,
            );

            if (!rec) {
                remove_btn.disable();
                edit_btn.disable();
                diskaction_btn.disable();
                revert_btn.disable();
                return;
            }
            const { key, value } = rec.data;
            const row = rows[key];

            const deleted = !!rec.data.delete;
            const pending = deleted || me.hasPendingChanges(key);
            const isRunning = me.pveSelNode.data.running;

            const isCloudInit = isCloudInitKey(value);
            const isCDRom = value && !!value.toString().match(/media=cdrom/);

            const isUnusedDisk = key.match(/^unused\d+/);
            const isUsedDisk = !isUnusedDisk && row.isOnStorageBus && !isCDRom;
            const isDisk = isUnusedDisk || isUsedDisk;
            const isEfi = key === 'efidisk0';
            const tpmMoveable = key === 'tpmstate0' && !isRunning;

            let cannotDelete = deleted || row.never_delete;
            cannotDelete ||= isCDRom && !cdromCap;
            cannotDelete ||= isDisk && !diskCap;
            cannotDelete ||= isCloudInit && noVMConfigCloudinitPerm;
            remove_btn.setDisabled(cannotDelete);

            remove_btn.setText(
                isUsedDisk && !isCloudInit ? remove_btn.altText : remove_btn.defaultText,
            );
            remove_btn.RESTMethod = isUnusedDisk || (isDisk && isRunning) ? 'POST' : 'PUT';

            edit_btn.setDisabled(
                deleted ||
                    !row.editor ||
                    isCloudInit ||
                    (isCDRom && !cdromCap) ||
                    (isDisk && !diskCap),
            );

            diskaction_btn.setDisabled(
                pending || !diskCap || isCloudInit || !(isDisk || isEfi || tpmMoveable),
            );
            reassign_menuitem.setDisabled(pending || isEfi || tpmMoveable);
            resize_menuitem.setDisabled(pending || !isUsedDisk);

            revert_btn.setDisabled(!pending);
        };

        let editorFactory = (classPath, extraOptions) => {
            extraOptions = extraOptions || {};
            return () =>
                Ext.create(`PVE.qemu.${classPath}`, {
                    autoShow: true,
                    url: `/api2/extjs/${baseurl}`,
                    pveSelNode: me.pveSelNode,
                    listeners: {
                        destroy: () => me.reload(),
                    },
                    isAdd: true,
                    isCreate: true,
                    ...extraOptions,
                });
        };

        Ext.apply(me, {
            url: `/api2/json/nodes/${nodename}/qemu/${vmid}/pending`,
            interval: 5000,
            selModel: sm,
            run_editor: run_editor,
            tbar: [
                {
                    text: gettext('Add'),
                    menu: new Ext.menu.Menu({
                        cls: 'pve-add-hw-menu',
                        items: [
                            {
                                text: gettext('Hard Disk'),
                                iconCls: 'fa fa-fw fa-hdd-o black',
                                disabled: !caps.vms['VM.Config.Disk'],
                                handler: editorFactory('HDEdit'),
                            },
                            {
                                text: gettext('Import Hard Disk'),
                                iconCls: 'fa fa-fw fa-cloud-download',
                                disabled: !caps.vms['VM.Config.Disk'],
                                handler: editorFactory('HDEdit', { importDisk: true }),
                            },
                            {
                                text: gettext('CD/DVD Drive'),
                                iconCls: 'pve-itype-icon-cdrom',
                                disabled: !caps.vms['VM.Config.CDROM'],
                                handler: editorFactory('CDEdit'),
                            },
                            {
                                text: gettext('Network Device'),
                                itemId: 'addNet',
                                iconCls: 'fa fa-fw fa-exchange black',
                                disabled: !caps.vms['VM.Config.Network'],
                                handler: editorFactory('NetworkEdit'),
                            },
                            efidisk_menuitem,
                            {
                                text: gettext('TPM State'),
                                itemId: 'addTpmState',
                                iconCls: 'fa fa-fw fa-hdd-o black',
                                disabled: !caps.vms['VM.Config.Disk'],
                                handler: editorFactory('TPMDiskEdit'),
                            },
                            {
                                text: gettext('USB Device'),
                                itemId: 'addUsb',
                                iconCls: 'fa fa-fw fa-usb black',
                                disabled:
                                    !caps.nodes['Sys.Console'] && !caps.mapping['Mapping.Use'],
                                handler: editorFactory('USBEdit'),
                            },
                            {
                                text: gettext('PCI Device'),
                                itemId: 'addPci',
                                iconCls: 'pve-itype-icon-pci',
                                disabled:
                                    !caps.nodes['Sys.Console'] && !caps.mapping['Mapping.Use'],
                                handler: editorFactory('PCIEdit'),
                            },
                            {
                                text: gettext('Serial Port'),
                                itemId: 'addSerial',
                                iconCls: 'pve-itype-icon-serial',
                                disabled: !caps.vms['VM.Config.Options'],
                                handler: editorFactory('SerialEdit'),
                            },
                            {
                                text: gettext('CloudInit Drive'),
                                itemId: 'addCloudinitDrive',
                                iconCls: 'fa fa-fw fa-cloud black',
                                disabled:
                                    !caps.vms['VM.Config.CDROM'] ||
                                    !caps.vms['VM.Config.Cloudinit'],
                                handler: editorFactory('CIDriveEdit'),
                            },
                            {
                                text: gettext('Audio Device'),
                                itemId: 'addAudio',
                                iconCls: 'fa fa-fw fa-volume-up black',
                                disabled: !caps.vms['VM.Config.HWType'],
                                handler: editorFactory('AudioEdit'),
                            },
                            {
                                text: gettext('VirtIO RNG'),
                                itemId: 'addRng',
                                iconCls: 'pve-itype-icon-die',
                                disabled:
                                    !caps.vms['VM.Config.HWType'] && !caps.mapping['Mapping.Use'],
                                handler: editorFactory('RNGEdit'),
                            },
                            {
                                text: gettext('Virtiofs'),
                                itemId: 'addVirtiofs',
                                iconCls: 'fa fa-folder',
                                disabled: !caps.nodes['Sys.Console'],
                                handler: editorFactory('VirtiofsEdit'),
                            },
                        ],
                    }),
                },
                remove_btn,
                edit_btn,
                diskaction_btn,
                revert_btn,
            ],
            rows: rows,
            sorterFn: sorterFn,
            listeners: {
                itemdblclick: run_editor,
                selectionchange: set_button_status,
            },
        });

        me.callParent();

        me.on('activate', me.rstore.startUpdate, me.rstore);
        me.on('destroy', me.rstore.stopUpdate, me.rstore);

        me.mon(me.getStore(), 'datachanged', set_button_status, me);
    },
});
