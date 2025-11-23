Ext.define('PVE.lxc.DNSInputPanel', {
    extend: 'Proxmox.panel.InputPanel',
    alias: 'widget.pveLxcDNSInputPanel',

    insideWizard: false,

    onGetValues: function (values) {
        var me = this;

        var deletes = [];
        if (!values.searchdomain && !me.insideWizard) {
            deletes.push('searchdomain');
        }

        if (values.nameserver) {
            let list = values.nameserver.split(/[ ,;]+/);
            values.nameserver = list.join(' ');
        } else if (!me.insideWizard) {
            deletes.push('nameserver');
        }

        if (deletes.length) {
            values.delete = deletes.join(',');
        }

        return values;
    },

    initComponent: function () {
        var me = this;

        var items = [
            {
                xtype: 'proxmoxtextfield',
                name: 'searchdomain',
                skipEmptyText: true,
                fieldLabel: gettext('DNS domain'),
                emptyText: gettext('use host settings'),
                allowBlank: true,
            },
            {
                xtype: 'proxmoxtextfield',
                fieldLabel: gettext('DNS servers'),
                vtype: 'IP64AddressWithSuffixList',
                allowBlank: true,
                emptyText: gettext('use host settings'),
                name: 'nameserver',
                itemId: 'nameserver',
            },
        ];

        if (me.insideWizard) {
            me.column1 = items;
        } else {
            me.items = items;
        }

        me.callParent();
    },
});

Ext.define('PVE.lxc.DNSEdit', {
    extend: 'Proxmox.window.Edit',

    initComponent: function () {
        var me = this;

        var ipanel = Ext.create('PVE.lxc.DNSInputPanel');

        Ext.apply(me, {
            subject: gettext('Resources'),
            items: [ipanel],
        });

        me.callParent();

        if (!me.isCreate) {
            me.load({
                success: function (response, options) {
                    var values = response.result.data;

                    if (values.nameserver) {
                        values.nameserver.replace(/[,;]/, ' ');
                        values.nameserver.replace(/^\s+/, '');
                    }

                    ipanel.setValues(values);
                },
            });
        }
    },
});

Ext.define('PVE.lxc.DNS', {
    extend: 'Proxmox.grid.PendingObjectGrid',
    alias: ['widget.pveLxcDNS'],

    onlineHelp: 'pct_container_network',

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

        var rows = {
            hostname: {
                required: true,
                defaultValue: me.pveSelNode.data.name,
                header: gettext('Hostname'),
                editor: caps.vms['VM.Config.Network']
                    ? {
                          xtype: 'proxmoxWindowEdit',
                          subject: gettext('Hostname'),
                          items: {
                              xtype: 'inputpanel',
                              items: {
                                  fieldLabel: gettext('Hostname'),
                                  xtype: 'textfield',
                                  name: 'hostname',
                                  vtype: 'DnsName',
                                  allowBlank: true,
                                  emptyText: 'CT' + vmid.toString(),
                              },
                              onGetValues: function (values) {
                                  var params = values;
                                  if (
                                      values.hostname === undefined ||
                                      values.hostname === null ||
                                      values.hostname === ''
                                  ) {
                                      params = { hostname: 'CT' + vmid.toString() };
                                  }
                                  return params;
                              },
                          },
                      }
                    : undefined,
            },
            searchdomain: {
                header: gettext('DNS domain'),
                defaultValue: '',
                editor: caps.vms['VM.Config.Network'] ? 'PVE.lxc.DNSEdit' : undefined,
                renderer: function (value) {
                    return value || gettext('use host settings');
                },
            },
            nameserver: {
                header: gettext('DNS server'),
                defaultValue: '',
                editor: caps.vms['VM.Config.Network'] ? 'PVE.lxc.DNSEdit' : undefined,
                renderer: function (value) {
                    return value || gettext('use host settings');
                },
            },
        };

        var baseurl = 'nodes/' + nodename + '/lxc/' + vmid + '/config';

        var reload = function () {
            me.rstore.load();
        };

        var sm = Ext.create('Ext.selection.RowModel', {});

        var run_editor = function () {
            var rec = sm.getSelection()[0];
            if (!rec) {
                return;
            }

            var rowdef = rows[rec.data.key];
            if (!rowdef.editor) {
                return;
            }

            var win;
            if (Ext.isString(rowdef.editor)) {
                win = Ext.create(rowdef.editor, {
                    pveSelNode: me.pveSelNode,
                    confid: rec.data.key,
                    url: '/api2/extjs/nodes/' + nodename + '/lxc/' + vmid + '/config',
                });
            } else {
                let config = Ext.apply(
                    {
                        pveSelNode: me.pveSelNode,
                        confid: rec.data.key,
                        url: '/api2/extjs/nodes/' + nodename + '/lxc/' + vmid + '/config',
                    },
                    rowdef.editor,
                );
                win = Ext.createWidget(rowdef.editor.xtype, config);
                win.load();
            }
            //win.load();
            win.show();
            win.on('destroy', reload);
        };

        var edit_btn = new Proxmox.button.Button({
            text: gettext('Edit'),
            disabled: true,
            selModel: sm,
            enableFn: function (rec) {
                var rowdef = rows[rec.data.key];
                return !!rowdef.editor;
            },
            handler: run_editor,
        });

        var revert_btn = new PVE.button.PendingRevert();

        var set_button_status = function () {
            let button_sm = me.getSelectionModel();
            let rec = button_sm.getSelection()[0];

            if (!rec) {
                edit_btn.disable();
                return;
            }
            let key = rec.data.key;

            let rowdef = rows[key];
            edit_btn.setDisabled(!rowdef.editor);

            let pending = rec.data.delete || me.hasPendingChanges(key);
            revert_btn.setDisabled(!pending);
        };

        Ext.apply(me, {
            url: '/api2/json/nodes/' + nodename + '/lxc/' + vmid + '/pending',
            selModel: sm,
            cwidth1: 150,
            interval: 5000,
            run_editor: run_editor,
            tbar: [edit_btn, revert_btn],
            rows: rows,
            editorConfig: {
                url: '/api2/extjs/' + baseurl,
            },
            listeners: {
                itemdblclick: run_editor,
                selectionchange: set_button_status,
                activate: reload,
            },
        });

        me.callParent();

        me.on('activate', me.rstore.startUpdate);
        me.on('destroy', me.rstore.stopUpdate);
        me.on('deactivate', me.rstore.stopUpdate);

        me.mon(me.getStore(), 'datachanged', function () {
            set_button_status();
        });
    },
});
