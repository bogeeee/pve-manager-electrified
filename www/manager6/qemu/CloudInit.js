Ext.define('PVE.qemu.CloudInit', {
    extend: 'Proxmox.grid.PendingObjectGrid',
    xtype: 'pveCiPanel',

    onlineHelp: 'qm_cloud_init',

    tbar: [
        {
            xtype: 'proxmoxButton',
            disabled: true,
            dangerous: true,
            confirmMsg: function (rec) {
                let view = this.up('grid');
                var warn = gettext('Are you sure you want to remove entry {0}');

                var entry = rec.data.key;
                var msg = Ext.String.format(warn, "'" + view.renderKey(entry, {}, rec) + "'");

                return msg;
            },
            enableFn: function (record) {
                let view = this.up('grid');
                var caps = Ext.state.Manager.get('GuiCap');
                let caps_ci = caps.vms['VM.Config.Network'] || caps.vms['VM.Config.Cloudinit'];
                if (view.rows[record.data.key].never_delete || !caps_ci) {
                    return false;
                }

                if (record.data.key === 'cipassword' && !record.data.value) {
                    return false;
                }
                return true;
            },
            handler: function () {
                let view = this.up('grid');
                let records = view.getSelection();
                if (!records || !records.length) {
                    return;
                }

                var id = records[0].data.key;
                var match = id.match(/^net(\d+)$/);
                if (match) {
                    id = 'ipconfig' + match[1];
                }

                var params = {};
                params.delete = id;
                Proxmox.Utils.API2Request({
                    url: view.baseurl + '/config',
                    waitMsgTarget: view,
                    method: 'PUT',
                    params: params,
                    failure: (response) => Ext.Msg.alert('Error', response.htmlStatus),
                    callback: function () {
                        view.reload();
                    },
                });
            },
            text: gettext('Remove'),
        },
        {
            xtype: 'proxmoxButton',
            disabled: true,
            enableFn: function (rec) {
                let view = this.up('pveCiPanel');
                return !!view.rows[rec.data.key].editor;
            },
            handler: function () {
                let view = this.up('grid');
                view.run_editor();
            },
            text: gettext('Edit'),
        },
        '-',
        {
            xtype: 'button',
            itemId: 'savebtn',
            text: gettext('Regenerate Image'),
            handler: function () {
                let view = this.up('grid');

                Proxmox.Utils.API2Request({
                    url: view.baseurl + '/cloudinit',
                    waitMsgTarget: view,
                    method: 'PUT',
                    failure: (response) => Ext.Msg.alert('Error', response.htmlStatus),
                    callback: function () {
                        view.reload();
                    },
                });
            },
        },
    ],

    border: false,

    set_button_status: function (rstore, records, success) {
        if (!success || records.length < 1) {
            return;
        }
        var me = this;
        var found;
        records.forEach(function (record) {
            if (found) {
                return;
            }
            var id = record.data.key;
            var value = record.data.value;
            var ciregex = new RegExp('vm-' + me.pveSelNode.data.vmid + '-cloudinit');
            if (id.match(/^(ide|scsi|sata)\d+$/) && ciregex.test(value)) {
                found = id;
                me.ciDriveId = found;
                me.ciDrive = value;
            }
        });

        let caps = Ext.state.Manager.get('GuiCap');
        let canRegenerateImage = !!caps.vms['VM.Config.Cloudinit'];
        me.down('#savebtn').setDisabled(!found || !canRegenerateImage);

        me.setDisabled(!found);
        if (!found) {
            me.getView().mask(gettext('No CloudInit Drive found'), ['pve-static-mask']);
        } else {
            me.getView().unmask();
        }
    },

    renderKey: function (key, metaData, rec, rowIndex, colIndex, store) {
        var me = this;
        var rows = me.rows;
        var rowdef = rows[key] || {};

        var icon = '';
        if (rowdef.iconCls) {
            icon = '<i class="' + rowdef.iconCls + '"></i> ';
        }
        return icon + (rowdef.header || key);
    },

    listeners: {
        activate: function () {
            var me = this;
            me.rstore.startUpdate();
        },
        itemdblclick: function () {
            var me = this;
            me.run_editor();
        },
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
        me.baseurl = '/api2/extjs/nodes/' + nodename + '/qemu/' + vmid;
        me.url = me.baseurl + '/pending';
        me.editorConfig.url = me.baseurl + '/config';
        me.editorConfig.pveSelNode = me.pveSelNode;

        let caps_ci = caps.vms['VM.Config.Cloudinit'] || caps.vms['VM.Config.Network'];
        /* editor is string and object */
        me.rows = {
            ciuser: {
                header: gettext('User'),
                iconCls: 'fa fa-user',
                never_delete: true,
                defaultValue: '',
                editor: caps_ci
                    ? {
                          xtype: 'proxmoxWindowEdit',
                          subject: gettext('User'),
                          items: [
                              {
                                  xtype: 'proxmoxtextfield',
                                  deleteEmpty: true,
                                  emptyText: Proxmox.Utils.defaultText,
                                  fieldLabel: gettext('User'),
                                  name: 'ciuser',
                              },
                          ],
                      }
                    : undefined,
                renderer: function (value) {
                    return Ext.String.htmlEncode(value || Proxmox.Utils.defaultText);
                },
            },
            cipassword: {
                header: gettext('Password'),
                iconCls: 'fa fa-unlock',
                defaultValue: '',
                editor: caps_ci
                    ? {
                          xtype: 'proxmoxWindowEdit',
                          subject: gettext('Password'),
                          items: [
                              {
                                  xtype: 'proxmoxtextfield',
                                  inputType: 'password',
                                  deleteEmpty: true,
                                  emptyText: Proxmox.Utils.noneText,
                                  fieldLabel: gettext('Password'),
                                  name: 'cipassword',
                              },
                          ],
                      }
                    : undefined,
                renderer: function (value) {
                    return Ext.String.htmlEncode(value || Proxmox.Utils.noneText);
                },
            },
            searchdomain: {
                header: gettext('DNS domain'),
                iconCls: 'fa fa-globe',
                editor: caps_ci ? 'PVE.lxc.DNSEdit' : undefined,
                never_delete: true,
                defaultValue: gettext('use host settings'),
            },
            nameserver: {
                header: gettext('DNS servers'),
                iconCls: 'fa fa-globe',
                editor: caps_ci ? 'PVE.lxc.DNSEdit' : undefined,
                never_delete: true,
                defaultValue: gettext('use host settings'),
            },
            sshkeys: {
                header: gettext('SSH public key'),
                iconCls: 'fa fa-key',
                editor: caps_ci ? 'PVE.qemu.SSHKeyEdit' : undefined,
                never_delete: true,
                renderer: function (value) {
                    value = decodeURIComponent(value);
                    var keys = value.split('\n');
                    var text = [];
                    keys.forEach(function (key) {
                        if (key.length) {
                            let res = PVE.Parser.parseSSHKey(key);
                            if (res) {
                                key = Ext.String.htmlEncode(res.comment);
                                if (res.options) {
                                    key +=
                                        ' <span style="color:gray">(' +
                                        gettext('with options') +
                                        ')</span>';
                                }
                                text.push(key);
                                return;
                            }
                            // Most likely invalid at this point, so just stick to
                            // the old value.
                            text.push(Ext.String.htmlEncode(key));
                        }
                    });
                    if (text.length) {
                        return text.join('<br>');
                    } else {
                        return Proxmox.Utils.noneText;
                    }
                },
                defaultValue: '',
            },
            ciupgrade: {
                header: gettext('Upgrade packages'),
                iconCls: 'fa fa-archive',
                renderer: Proxmox.Utils.format_boolean,
                defaultValue: 1,
                editor: {
                    xtype: 'proxmoxWindowEdit',
                    subject: gettext('Upgrade packages on boot'),
                    items: {
                        xtype: 'proxmoxcheckbox',
                        name: 'ciupgrade',
                        uncheckedValue: 0,
                        value: 1, // serves as default value, using defaultValue is not enough
                        fieldLabel: gettext('Upgrade packages'),
                        labelWidth: 140,
                    },
                },
            },
        };
        var i;
        var ipconfig_renderer = function (value, md, record, ri, ci, store, pending) {
            var id = record.data.key;
            var match = id.match(/^net(\d+)$/);
            var val = '';
            if (match) {
                val = me.getObjectValue('ipconfig' + match[1], '', pending);
            }
            return val;
        };
        for (i = 0; i < 32; i++) {
            // we want to show an entry for every network device
            // even if it is empty
            me.rows['net' + i.toString()] = {
                multiKey: ['ipconfig' + i.toString(), 'net' + i.toString()],
                header: gettext('IP Config') + ' (net' + i.toString() + ')',
                editor: caps_ci ? 'PVE.qemu.IPConfigEdit' : undefined,
                iconCls: 'fa fa-exchange',
                renderer: ipconfig_renderer,
            };
            me.rows['ipconfig' + i.toString()] = {
                visible: false,
            };
        }

        PVE.Utils.forEachBus(['ide', 'scsi', 'sata'], function (type, id) {
            me.rows[type + id] = {
                visible: false,
            };
        });
        me.callParent();
        me.mon(me.rstore, 'load', me.set_button_status, me);
    },
});
