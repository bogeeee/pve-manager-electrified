Ext.define('pve-security-groups', {
    extend: 'Ext.data.Model',

    fields: ['group', 'comment', 'digest'],
    idProperty: 'group',
});

Ext.define('PVE.SecurityGroupEdit', {
    extend: 'Proxmox.window.Edit',

    base_url: '/cluster/firewall/groups',

    allow_iface: false,

    initComponent: function () {
        var me = this;

        me.isCreate = me.group_name === undefined;

        var subject;

        me.url = '/api2/extjs' + me.base_url;
        me.method = 'POST';

        var items = [
            {
                xtype: 'textfield',
                name: 'group',
                value: me.group_name || '',
                fieldLabel: gettext('Name'),
                allowBlank: false,
            },
            {
                xtype: 'textfield',
                name: 'comment',
                value: me.group_comment || '',
                fieldLabel: gettext('Comment'),
            },
        ];

        if (me.isCreate) {
            subject = gettext('Security Group');
        } else {
            subject = gettext('Security Group') + " '" + me.group_name + "'";
            items.push({
                xtype: 'hiddenfield',
                name: 'rename',
                value: me.group_name,
            });
        }

        var ipanel = Ext.create('Proxmox.panel.InputPanel', {
            // InputPanel does not have a 'create' property, does it need a 'isCreate'
            isCreate: me.isCreate,
            items: items,
        });

        Ext.apply(me, {
            subject: subject,
            items: [ipanel],
        });

        me.callParent();
    },
});

Ext.define('PVE.SecurityGroupList', {
    extend: 'Ext.grid.Panel',
    alias: 'widget.pveSecurityGroupList',

    stateful: true,
    stateId: 'grid-securitygroups',

    rulePanel: undefined,

    addBtn: undefined,
    removeBtn: undefined,
    editBtn: undefined,

    base_url: '/cluster/firewall/groups',

    initComponent: function () {
        let me = this;
        if (!me.base_url) {
            throw 'no base_url specified';
        }

        let store = new Ext.data.Store({
            model: 'pve-security-groups',
            proxy: {
                type: 'proxmox',
                url: '/api2/json' + me.base_url,
            },
            sorters: {
                property: 'group',
                direction: 'ASC',
            },
        });

        let sm = Ext.create('Ext.selection.RowModel', {});

        let caps = Ext.state.Manager.get('GuiCap');
        let canEdit = !!caps.dc['Sys.Modify'];

        let reload = function () {
            let oldrec = sm.getSelection()[0];
            store.load((records, operation, success) => {
                if (oldrec) {
                    let rec = store.findRecord('group', oldrec.data.group, 0, false, true, true);
                    if (rec) {
                        sm.select(rec);
                    }
                }
            });
        };

        let run_editor = function () {
            let rec = sm.getSelection()[0];
            if (!rec || !canEdit) {
                return;
            }
            Ext.create('PVE.SecurityGroupEdit', {
                digest: rec.data.digest,
                group_name: rec.data.group,
                group_comment: rec.data.comment,
                listeners: {
                    destroy: () => reload(),
                },
                autoShow: true,
            });
        };

        me.editBtn = new Proxmox.button.Button({
            text: gettext('Edit'),
            enableFn: (rec) => canEdit,
            disabled: true,
            selModel: sm,
            handler: run_editor,
        });
        me.addBtn = new Proxmox.button.Button({
            text: gettext('Create'),
            disabled: !canEdit,
            handler: function () {
                sm.deselectAll();
                var win = Ext.create('PVE.SecurityGroupEdit', {});
                win.show();
                win.on('destroy', reload);
            },
        });

        me.removeBtn = Ext.create('Proxmox.button.StdRemoveButton', {
            selModel: sm,
            baseurl: me.base_url + '/',
            enableFn: (rec) => canEdit && rec && me.base_url,
            callback: () => reload(),
        });

        Ext.apply(me, {
            store: store,
            tbar: ['<b>' + gettext('Group') + ':</b>', me.addBtn, me.removeBtn, me.editBtn],
            selModel: sm,
            columns: [
                {
                    header: gettext('Group'),
                    dataIndex: 'group',
                    width: '100',
                },
                {
                    header: gettext('Comment'),
                    dataIndex: 'comment',
                    renderer: Ext.String.htmlEncode,
                    flex: 1,
                },
            ],
            listeners: {
                itemdblclick: run_editor,
                select: function (_sm, rec) {
                    if (!me.rulePanel) {
                        me.rulePanel = me.up('panel').down('pveFirewallRules');
                    }
                    me.rulePanel.setBaseUrl(`/cluster/firewall/groups/${rec.data.group}`);
                },
                deselect: function () {
                    if (!me.rulePanel) {
                        me.rulePanel = me.up('panel').down('pveFirewallRules');
                    }
                    me.rulePanel.setBaseUrl(undefined);
                },
                show: reload,
            },
        });

        me.callParent();

        store.load();
    },
});

Ext.define('PVE.SecurityGroups', {
    extend: 'Ext.panel.Panel',
    alias: 'widget.pveSecurityGroups',

    title: 'Security Groups',
    onlineHelp: 'pve_firewall_security_groups',

    layout: 'border',

    items: [
        {
            xtype: 'pveFirewallRules',
            region: 'center',
            allow_groups: false,
            list_refs_url: '/cluster/firewall/refs',
            tbar_prefix: '<b>' + gettext('Rules') + ':</b>',
            border: false,
            firewall_type: 'group',
        },
        {
            xtype: 'pveSecurityGroupList',
            region: 'west',
            width: '25%',
            border: false,
            split: true,
        },
    ],
    listeners: {
        show: function () {
            let sglist = this.down('pveSecurityGroupList');
            sglist.fireEvent('show', sglist);
        },
    },
});
