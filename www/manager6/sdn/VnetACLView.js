Ext.define('PVE.sdn.VnetACLAdd', {
    extend: 'Proxmox.window.Edit',
    alias: ['widget.pveSDNVnetACLAdd'],

    url: '/access/acl',
    method: 'PUT',
    isAdd: true,
    isCreate: true,

    width: 400,
    initComponent: function () {
        let me = this;

        let items = [
            {
                xtype: 'hiddenfield',
                name: 'path',
                value: me.path,
                allowBlank: false,
                fieldLabel: gettext('Path'),
            },
        ];

        if (me.aclType === 'group') {
            me.subject = gettext('Group Permission');
            items.push({
                xtype: 'pveGroupSelector',
                name: 'groups',
                fieldLabel: gettext('Group'),
            });
        } else if (me.aclType === 'user') {
            me.subject = gettext('User Permission');
            items.push({
                xtype: 'pmxUserSelector',
                name: 'users',
                fieldLabel: gettext('User'),
            });
        } else if (me.aclType === 'token') {
            me.subject = gettext('API Token Permission');
            items.push({
                xtype: 'pveTokenSelector',
                name: 'tokens',
                fieldLabel: gettext('API Token'),
            });
        } else {
            throw 'unknown ACL type';
        }

        items.push({
            xtype: 'pmxRoleSelector',
            name: 'roles',
            value: 'NoAccess',
            fieldLabel: gettext('Role'),
        });

        items.push({
            xtype: 'proxmoxintegerfield',
            name: 'vlan',
            minValue: 1,
            maxValue: 4096,
            allowBlank: true,
            fieldLabel: 'VLAN',
            emptyText: gettext('All'),
        });

        let ipanel = Ext.create('Proxmox.panel.InputPanel', {
            items: items,
            onlineHelp: 'pveum_permission_management',
            onGetValues: function (values) {
                if (values.vlan) {
                    values.path = values.path + '/' + values.vlan;
                    delete values.vlan;
                }
                return values;
            },
        });

        Ext.apply(me, {
            items: [ipanel],
        });

        me.callParent();
    },
});

Ext.define(
    'PVE.sdn.VnetACLView',
    {
        extend: 'Ext.grid.GridPanel',

        alias: ['widget.pveSDNVnetACLView'],

        onlineHelp: 'chapter_user_management',

        stateful: true,
        stateId: 'grid-acls',

        // use fixed path
        path: undefined,

        setPath: function (path) {
            let me = this;

            me.path = path;

            if (path === undefined) {
                me.down('#groupmenu').setDisabled(true);
                me.down('#usermenu').setDisabled(true);
                me.down('#tokenmenu').setDisabled(true);
            } else {
                me.down('#groupmenu').setDisabled(false);
                me.down('#usermenu').setDisabled(false);
                me.down('#tokenmenu').setDisabled(false);
                me.store.load();
            }
        },
        initComponent: function () {
            let me = this;

            let store = Ext.create('Ext.data.Store', {
                model: 'pve-acl',
                proxy: {
                    type: 'proxmox',
                    url: '/api2/json/access/acl',
                },
                sorters: {
                    property: 'path',
                    direction: 'ASC',
                },
            });

            store.addFilter(
                Ext.create('Ext.util.Filter', {
                    filterFn: (item) =>
                        item.data.path.replace(/(\/sdn\/zones\/(.*)\/(.*))\/[0-9]*$/, '$1') ===
                        me.path,
                }),
            );

            let render_ugid = function (ugid, metaData, record) {
                if (record.data.type === 'group') {
                    return '@' + ugid;
                }

                return Ext.String.htmlEncode(ugid);
            };

            let render_vlan = function (path, metaData, record) {
                let vlan = 'any';
                const match = path.match(/(\/sdn\/zones\/)(.*)\/(.*)\/([0-9]*)$/);
                if (match) {
                    vlan = match[4];
                }

                return Ext.String.htmlEncode(vlan);
            };

            let columns = [
                {
                    header: gettext('User') + '/' + gettext('Group') + '/' + gettext('API Token'),
                    flex: 1,
                    sortable: true,
                    renderer: render_ugid,
                    dataIndex: 'ugid',
                },
                {
                    header: gettext('Role'),
                    flex: 1,
                    sortable: true,
                    dataIndex: 'roleid',
                },
                {
                    header: gettext('VLAN'),
                    flex: 1,
                    sortable: true,
                    renderer: render_vlan,
                    dataIndex: 'path',
                },
            ];

            let sm = Ext.create('Ext.selection.RowModel', {});

            let remove_btn = new Proxmox.button.Button({
                text: gettext('Remove'),
                disabled: true,
                selModel: sm,
                confirmMsg: gettext('Are you sure you want to remove this entry'),
                handler: function (btn, event, rec) {
                    var params = {
                        delete: 1,
                        path: rec.data.path,
                        roles: rec.data.roleid,
                    };
                    if (rec.data.type === 'group') {
                        params.groups = rec.data.ugid;
                    } else if (rec.data.type === 'user') {
                        params.users = rec.data.ugid;
                    } else if (rec.data.type === 'token') {
                        params.tokens = rec.data.ugid;
                    } else {
                        throw 'unknown data type';
                    }

                    Proxmox.Utils.API2Request({
                        url: '/access/acl',
                        params: params,
                        method: 'PUT',
                        waitMsgTarget: me,
                        callback: () => store.load(),
                        failure: (response) => Ext.Msg.alert(gettext('Error'), response.htmlStatus),
                    });
                },
            });

            Proxmox.Utils.monStoreErrors(me, store);

            Ext.apply(me, {
                store: store,
                selModel: sm,
                tbar: [
                    {
                        text: gettext('Add'),
                        menu: {
                            xtype: 'menu',
                            items: [
                                {
                                    text: gettext('Group Permission'),
                                    disabled: !me.path,
                                    itemId: 'groupmenu',
                                    iconCls: 'fa fa-fw fa-group',
                                    handler: function () {
                                        var win = Ext.create('PVE.sdn.VnetACLAdd', {
                                            aclType: 'group',
                                            path: me.path,
                                        });
                                        win.on('destroy', () => store.load());
                                        win.show();
                                    },
                                },
                                {
                                    text: gettext('User Permission'),
                                    disabled: !me.path,
                                    itemId: 'usermenu',
                                    iconCls: 'fa fa-fw fa-user',
                                    handler: function () {
                                        var win = Ext.create('PVE.sdn.VnetACLAdd', {
                                            aclType: 'user',
                                            path: me.path,
                                        });
                                        win.on('destroy', () => store.load());
                                        win.show();
                                    },
                                },
                                {
                                    text: gettext('API Token Permission'),
                                    disabled: !me.path,
                                    itemId: 'tokenmenu',
                                    iconCls: 'fa fa-fw fa-user-o',
                                    handler: function () {
                                        let win = Ext.create('PVE.sdn.VnetACLAdd', {
                                            aclType: 'token',
                                            path: me.path,
                                        });
                                        win.on('destroy', () => store.load());
                                        win.show();
                                    },
                                },
                            ],
                        },
                    },
                    remove_btn,
                ],
                viewConfig: {
                    trackOver: false,
                },
                columns: columns,
                listeners: {},
            });

            me.callParent();
        },
    },
    function () {
        Ext.define('pve-acl-vnet', {
            extend: 'Ext.data.Model',
            fields: [
                'path',
                'type',
                'ugid',
                'roleid',
                {
                    name: 'propagate',
                    type: 'boolean',
                },
            ],
        });
    },
);
