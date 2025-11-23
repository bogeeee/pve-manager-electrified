Ext.define('PVE.lxc.RessourceView', {
    extend: 'Proxmox.grid.PendingObjectGrid',
    alias: ['widget.pveLxcRessourceView'],

    onlineHelp: 'pct_configuration',

    renderKey: function (key, metaData, rec, rowIndex, colIndex, store) {
        let me = this;
        let rowdef = me.rows[key] || {};

        let txt = rowdef.header || key;
        let icon = '';

        metaData.tdAttr = 'valign=middle';
        if (rowdef.tdCls) {
            metaData.tdCls = rowdef.tdCls;
        } else if (rowdef.iconCls) {
            icon = `<i class='pve-grid-fa fa fa-fw fa-${rowdef.iconCls}'></i>`;
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

        var nodename = me.pveSelNode.data.node;
        if (!nodename) {
            throw 'no node name specified';
        }

        var vmid = me.pveSelNode.data.vmid;
        if (!vmid) {
            throw 'no VM ID specified';
        }

        var caps = Ext.state.Manager.get('GuiCap');
        var diskCap = caps.vms['VM.Config.Disk'];

        var mpeditor = caps.vms['VM.Config.Disk'] ? 'PVE.lxc.MountPointEdit' : undefined;

        const nodeInfo = PVE.data.ResourceStore.getNodes().find((node) => node.node === nodename);
        let cpuEditor = {
            xtype: 'pveLxcCPUEdit',
            cgroupMode: nodeInfo['cgroup-mode'],
        };

        var rows = {
            memory: {
                header: gettext('Memory'),
                editor: caps.vms['VM.Config.Memory'] ? 'PVE.lxc.MemoryEdit' : undefined,
                defaultValue: 512,
                tdCls: 'pmx-itype-icon-memory',
                group: 1,
                renderer: function (value) {
                    return Proxmox.Utils.format_size(value * 1024 * 1024);
                },
            },
            swap: {
                header: gettext('Swap'),
                editor: caps.vms['VM.Config.Memory'] ? 'PVE.lxc.MemoryEdit' : undefined,
                defaultValue: 512,
                iconCls: 'refresh',
                group: 2,
                renderer: function (value) {
                    return Proxmox.Utils.format_size(value * 1024 * 1024);
                },
            },
            cores: {
                header: gettext('Cores'),
                editor: caps.vms['VM.Config.CPU'] ? cpuEditor : undefined,
                defaultValue: '',
                tdCls: 'pmx-itype-icon-processor',
                group: 3,
                renderer: function (value) {
                    var cpulimit = me.getObjectValue('cpulimit');
                    var cpuunits = me.getObjectValue('cpuunits');
                    var res;
                    if (value) {
                        res = value;
                    } else {
                        res = gettext('unlimited');
                    }

                    if (cpulimit) {
                        res += ' [cpulimit=' + cpulimit + ']';
                    }

                    if (cpuunits) {
                        res += ' [cpuunits=' + cpuunits + ']';
                    }
                    return res;
                },
            },
            rootfs: {
                header: gettext('Root Disk'),
                defaultValue: Proxmox.Utils.noneText,
                editor: mpeditor,
                iconCls: 'hdd-o',
                group: 4,
                renderer: Ext.htmlEncode,
            },
            cpulimit: {
                visible: false,
            },
            cpuunits: {
                visible: false,
            },
            unprivileged: {
                visible: false,
            },
        };

        PVE.Utils.forEachLxcMP(function (bus, i, confid) {
            var group = 5;
            var header;
            if (bus === 'mp') {
                header = gettext('Mount Point') + ' (' + confid + ')';
            } else {
                header = gettext('Unused Disk') + ' ' + i;
                group += 1;
            }
            rows[confid] = {
                group: group,
                order: i,
                iconCls: 'hdd-o',
                editor: mpeditor,
                header: header,
                renderer: Ext.htmlEncode,
            };
        }, true);

        let deveditor = Proxmox.UserName === 'root@pam' ? 'PVE.lxc.DeviceEdit' : undefined;

        PVE.Utils.forEachLxcDev(function (i, confid) {
            rows[confid] = {
                group: 7,
                order: i,
                tdCls: 'pve-itype-icon-pci',
                editor: deveditor,
                header: gettext('Device') + ' (' + confid + ')',
                renderer: Ext.htmlEncode,
            };
        });

        var baseurl = 'nodes/' + nodename + '/lxc/' + vmid + '/config';

        me.selModel = Ext.create('Ext.selection.RowModel', {});

        var run_resize = function () {
            var rec = me.selModel.getSelection()[0];
            if (!rec) {
                return;
            }

            var win = Ext.create('PVE.window.MPResize', {
                disk: rec.data.key,
                nodename: nodename,
                vmid: vmid,
            });

            win.show();
        };

        var run_remove = function (b, e, rec) {
            Proxmox.Utils.API2Request({
                url: '/api2/extjs/' + baseurl,
                waitMsgTarget: me,
                method: 'PUT',
                params: {
                    delete: rec.data.key,
                },
                failure: function (response, opts) {
                    Ext.Msg.alert('Error', response.htmlStatus);
                },
            });
        };

        let run_move = function () {
            let rec = me.selModel.getSelection()[0];
            if (!rec) {
                return;
            }

            var win = Ext.create('PVE.window.HDMove', {
                disk: rec.data.key,
                nodename: nodename,
                vmid: vmid,
                type: 'lxc',
            });

            win.show();

            win.on('destroy', me.reload, me);
        };

        let run_reassign = function () {
            let rec = me.selModel.getSelection()[0];
            if (!rec) {
                return;
            }

            Ext.create('PVE.window.GuestDiskReassign', {
                disk: rec.data.key,
                nodename: nodename,
                autoShow: true,
                vmid: vmid,
                type: 'lxc',
                listeners: {
                    destroy: () => me.reload(),
                },
            });
        };

        var edit_btn = new Proxmox.button.Button({
            text: gettext('Edit'),
            selModel: me.selModel,
            disabled: true,
            enableFn: function (rec) {
                if (!rec) {
                    return false;
                }
                var rowdef = rows[rec.data.key];
                return !!rowdef.editor;
            },
            handler: function () {
                me.run_editor();
            },
        });

        var remove_btn = new Proxmox.button.Button({
            text: gettext('Remove'),
            defaultText: gettext('Remove'),
            altText: gettext('Detach'),
            selModel: me.selModel,
            disabled: true,
            dangerous: true,
            confirmMsg: function (rec) {
                let warn = Ext.String.format(gettext('Are you sure you want to remove entry {0}'));
                if (this.text === this.altText) {
                    warn = gettext('Are you sure you want to detach entry {0}');
                }
                let rendered = me.renderKey(rec.data.key, {}, rec);
                let msg = Ext.String.format(warn, `'${rendered}'`);

                if (rec.data.key.match(/^unused\d+$/)) {
                    msg += ' ' + gettext('This will permanently erase all data.');
                }
                return msg;
            },
            handler: run_remove,
            listeners: {
                render: function (btn) {
                    // hack: calculate the max button width on first display to prevent the whole
                    // toolbar to move when we switch between the "Remove" and "Detach" labels
                    let def = btn.getSize().width;

                    btn.setText(btn.altText);
                    let alt = btn.getSize().width;

                    btn.setText(btn.defaultText);

                    let optimal = alt > def ? alt : def;
                    btn.setSize({ width: optimal });
                },
            },
        });

        let move_menuitem = new Ext.menu.Item({
            text: gettext('Move Storage'),
            tooltip: gettext('Move volume to another storage'),
            iconCls: 'fa fa-database',
            selModel: me.selModel,
            handler: run_move,
        });

        let reassign_menuitem = new Ext.menu.Item({
            text: gettext('Reassign Owner'),
            tooltip: gettext('Reassign volume to another CT'),
            iconCls: 'fa fa-cube',
            handler: run_reassign,
            reference: 'reassing_item',
        });

        let resize_menuitem = new Ext.menu.Item({
            text: gettext('Resize'),
            iconCls: 'fa fa-plus',
            selModel: me.selModel,
            handler: run_resize,
        });

        let volumeaction_btn = new Proxmox.button.Button({
            text: gettext('Volume Action'),
            disabled: true,
            menu: {
                items: [move_menuitem, reassign_menuitem, resize_menuitem],
            },
        });

        let revert_btn = new PVE.button.PendingRevert();

        let set_button_status = function () {
            let rec = me.selModel.getSelection()[0];

            if (!rec) {
                edit_btn.disable();
                remove_btn.disable();
                volumeaction_btn.disable();
                revert_btn.disable();
                return;
            }
            let { key, value, delete: isDelete } = rec.data;
            let rowdef = rows[key];

            let pending = isDelete || me.hasPendingChanges(key);
            let isRootFS = key === 'rootfs';
            let isDisk = isRootFS || key.match(/^(mp|unused)\d+/);
            let isUnusedDisk = key.match(/^unused\d+/);
            let isUsedDisk = isDisk && !isUnusedDisk;
            let isDevice = key.match(/^dev\d+/);

            let noedit = isDelete || !rowdef.editor;
            if (!noedit && Proxmox.UserName !== 'root@pam' && key.match(/^mp\d+$/)) {
                let mp = PVE.Parser.parseLxcMountPoint(value);
                if (mp.type !== 'volume') {
                    noedit = true;
                }
            }
            edit_btn.setDisabled(noedit);

            volumeaction_btn.setDisabled(!isDisk || !diskCap);
            move_menuitem.setDisabled(isUnusedDisk);
            reassign_menuitem.setDisabled(isRootFS);
            resize_menuitem.setDisabled(isUnusedDisk);

            remove_btn.setDisabled(!(isDisk || isDevice) || isRootFS || !diskCap || pending);
            revert_btn.setDisabled(!pending);

            remove_btn.setText(isUsedDisk ? remove_btn.altText : remove_btn.defaultText);
        };

        let sorterFn = function (rec1, rec2) {
            let v1 = rec1.data.key,
                v2 = rec2.data.key;

            let g1 = rows[v1].group || 0,
                g2 = rows[v2].group || 0;
            if (g1 - g2 !== 0) {
                return g1 - g2;
            }

            let order1 = rows[v1].order || 0,
                order2 = rows[v2].order || 0;
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

        Ext.apply(me, {
            url: `/api2/json/nodes/${nodename}/lxc/${vmid}/pending`,
            selModel: me.selModel,
            interval: 2000,
            cwidth1: 170,
            tbar: [
                {
                    text: gettext('Add'),
                    menu: new Ext.menu.Menu({
                        items: [
                            {
                                text: gettext('Mount Point'),
                                iconCls: 'fa fa-fw fa-hdd-o black',
                                disabled: !caps.vms['VM.Config.Disk'],
                                handler: function () {
                                    Ext.create('PVE.lxc.MountPointEdit', {
                                        autoShow: true,
                                        url: `/api2/extjs/${baseurl}`,
                                        unprivileged: me.getObjectValue('unprivileged'),
                                        pveSelNode: me.pveSelNode,
                                        listeners: {
                                            destroy: () => me.reload(),
                                        },
                                    });
                                },
                            },
                            {
                                text: gettext('Device Passthrough'),
                                iconCls: 'pve-itype-icon-pci',
                                disabled: Proxmox.UserName !== 'root@pam',
                                handler: function () {
                                    Ext.create('PVE.lxc.DeviceEdit', {
                                        autoShow: true,
                                        url: `/api2/extjs/${baseurl}`,
                                        pveSelNode: me.pveSelNode,
                                        listeners: {
                                            destroy: () => me.reload(),
                                        },
                                    });
                                },
                            },
                        ],
                    }),
                },
                edit_btn,
                remove_btn,
                volumeaction_btn,
                revert_btn,
            ],
            rows: rows,
            sorterFn: sorterFn,
            editorConfig: {
                pveSelNode: me.pveSelNode,
                url: '/api2/extjs/' + baseurl,
            },
            listeners: {
                itemdblclick: me.run_editor,
                selectionchange: set_button_status,
            },
        });

        me.callParent();

        me.on('activate', me.rstore.startUpdate);
        me.on('destroy', me.rstore.stopUpdate);
        me.on('deactivate', me.rstore.stopUpdate);

        me.mon(me.getStore(), 'datachanged', function () {
            set_button_status();
        });

        Ext.apply(me.editorConfig, { unprivileged: me.getObjectValue('unprivileged') });
    },
});
