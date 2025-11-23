Ext.define('PVE.FirewallAliasEdit', {
    extend: 'Proxmox.window.Edit',

    base_url: undefined,

    alias_name: undefined,

    width: 400,

    initComponent: function () {
        let me = this;

        me.isCreate = me.alias_name === undefined;

        if (me.isCreate) {
            me.url = '/api2/extjs' + me.base_url;
            me.method = 'POST';
        } else {
            me.url = '/api2/extjs' + me.base_url + '/' + me.alias_name;
            me.method = 'PUT';
        }

        let ipanel = Ext.create('Proxmox.panel.InputPanel', {
            isCreate: me.isCreate,
            items: [
                {
                    xtype: 'textfield',
                    name: me.isCreate ? 'name' : 'rename',
                    fieldLabel: gettext('Name'),
                    allowBlank: false,
                },
                {
                    xtype: 'textfield',
                    name: 'cidr',
                    fieldLabel: gettext('IP/CIDR'),
                    allowBlank: false,
                },
                {
                    xtype: 'textfield',
                    name: 'comment',
                    fieldLabel: gettext('Comment'),
                },
            ],
        });

        Ext.apply(me, {
            subject: gettext('Alias'),
            isAdd: true,
            items: [ipanel],
        });

        me.callParent();

        if (!me.isCreate) {
            me.load({
                success: function (response, options) {
                    let values = response.result.data;
                    values.rename = values.name;
                    ipanel.setValues(values);
                },
            });
        }
    },
});

Ext.define('pve-fw-aliases', {
    extend: 'Ext.data.Model',

    fields: ['name', 'cidr', 'comment', 'digest'],
    idProperty: 'name',
});

Ext.define('PVE.FirewallAliases', {
    extend: 'Ext.grid.Panel',
    alias: ['widget.pveFirewallAliases'],

    onlineHelp: 'pve_firewall_ip_aliases',

    stateful: true,
    stateId: 'grid-firewall-aliases',

    base_url: undefined,

    title: gettext('Alias'),

    initComponent: function () {
        let me = this;

        if (!me.base_url) {
            throw 'missing base_url configuration';
        }

        let store = new Ext.data.Store({
            model: 'pve-fw-aliases',
            proxy: {
                type: 'proxmox',
                url: '/api2/json' + me.base_url,
            },
            sorters: {
                property: 'name',
                direction: 'ASC',
            },
        });

        let sm = Ext.create('Ext.selection.RowModel', {});

        let caps = Ext.state.Manager.get('GuiCap');
        let canEdit =
            !!caps.vms['VM.Config.Network'] ||
            !!caps.dc['Sys.Modify'] ||
            !!caps.nodes['Sys.Modify'];

        let reload = function () {
            let oldrec = sm.getSelection()[0];
            store.load(function (records, operation, success) {
                if (oldrec) {
                    let rec = store.findRecord('name', oldrec.data.name, 0, false, true, true);
                    if (rec) {
                        sm.select(rec);
                    }
                }
            });
        };

        let run_editor = function () {
            let rec = me.getSelectionModel().getSelection()[0];
            if (!rec || !canEdit) {
                return;
            }
            let win = Ext.create('PVE.FirewallAliasEdit', {
                base_url: me.base_url,
                alias_name: rec.data.name,
            });
            win.show();
            win.on('destroy', reload);
        };

        me.editBtn = new Proxmox.button.Button({
            text: gettext('Edit'),
            disabled: true,
            selModel: sm,
            enableFn: (rec) => canEdit,
            handler: run_editor,
        });

        me.addBtn = Ext.create('Ext.Button', {
            text: gettext('Add'),
            disabled:
                !caps.vms['VM.Config.Network'] &&
                !caps.dc['Sys.Modify'] &&
                !caps.nodes['Sys.Modify'],
            handler: function () {
                var win = Ext.create('PVE.FirewallAliasEdit', {
                    base_url: me.base_url,
                });
                win.on('destroy', reload);
                win.show();
            },
        });

        me.removeBtn = Ext.create('Proxmox.button.StdRemoveButton', {
            disabled: true,
            selModel: sm,
            enableFn: (rec) =>
                !!caps.vms['VM.Config.Network'] ||
                !!caps.dc['Sys.Modify'] ||
                !!caps.nodes['Sys.Modify'],
            baseurl: me.base_url + '/',
            callback: reload,
        });

        Ext.apply(me, {
            store: store,
            tbar: [me.addBtn, me.removeBtn, me.editBtn],
            selModel: sm,
            columns: [
                {
                    header: gettext('Name'),
                    dataIndex: 'name',
                    flex: 1,
                },
                {
                    header: gettext('IP/CIDR'),
                    dataIndex: 'cidr',
                    flex: 1,
                },
                {
                    header: gettext('Comment'),
                    dataIndex: 'comment',
                    renderer: Ext.String.htmlEncode,
                    flex: 3,
                },
            ],
            listeners: {
                itemdblclick: run_editor,
            },
        });

        me.callParent();
        me.on('activate', reload);
    },
});
