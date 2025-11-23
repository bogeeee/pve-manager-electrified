Ext.define('PVE.node.CreateDirectory', {
    extend: 'Proxmox.window.Edit',
    xtype: 'pveCreateDirectory',

    subject: Proxmox.Utils.directoryText,

    showProgress: true,

    onlineHelp: 'chapter_storage',

    initComponent: function () {
        var me = this;

        if (!me.nodename) {
            throw 'no node name specified';
        }

        me.isCreate = true;

        Ext.applyIf(me, {
            url: '/nodes/' + me.nodename + '/disks/directory',
            method: 'POST',
            items: [
                {
                    xtype: 'pmxDiskSelector',
                    name: 'device',
                    nodename: me.nodename,
                    diskType: 'unused',
                    includePartitions: true,
                    fieldLabel: gettext('Disk'),
                    allowBlank: false,
                },
                {
                    xtype: 'proxmoxKVComboBox',
                    comboItems: [
                        ['ext4', 'ext4'],
                        ['xfs', 'xfs'],
                    ],
                    fieldLabel: gettext('Filesystem'),
                    name: 'filesystem',
                    value: '',
                    allowBlank: false,
                },
                {
                    xtype: 'proxmoxtextfield',
                    name: 'name',
                    fieldLabel: gettext('Name'),
                    allowBlank: false,
                },
                {
                    xtype: 'proxmoxcheckbox',
                    name: 'add_storage',
                    fieldLabel: gettext('Add Storage'),
                    value: '1',
                },
            ],
        });

        me.callParent();
    },
});

Ext.define('PVE.node.Directorylist', {
    extend: 'Ext.grid.Panel',
    xtype: 'pveDirectoryList',

    viewModel: {
        data: {
            path: '',
        },
        formulas: {
            dirName: (get) => get('path')?.replace('/mnt/pve/', '') || undefined,
        },
    },

    controller: {
        xclass: 'Ext.app.ViewController',

        destroyDirectory: function () {
            let me = this;
            let vm = me.getViewModel();
            let view = me.getView();

            const dirName = vm.get('dirName');

            if (!view.nodename) {
                throw 'no node name specified';
            }

            if (!dirName) {
                throw 'no directory name specified';
            }

            Ext.create('PVE.window.SafeDestroyStorage', {
                url: `/nodes/${view.nodename}/disks/directory/${dirName}`,
                item: { id: dirName },
                taskName: 'dirremove',
                taskDone: () => {
                    view.reload();
                },
            }).show();
        },
    },

    stateful: true,
    stateId: 'grid-node-directory',
    columns: [
        {
            text: gettext('Path'),
            dataIndex: 'path',
            flex: 1,
        },
        {
            header: gettext('Device'),
            flex: 1,
            dataIndex: 'device',
        },
        {
            header: gettext('Type'),
            width: 100,
            dataIndex: 'type',
        },
        {
            header: gettext('Options'),
            width: 100,
            dataIndex: 'options',
        },
        {
            header: gettext('Unit File'),
            hidden: true,
            dataIndex: 'unitfile',
        },
    ],

    rootVisible: false,
    useArrows: true,

    tbar: [
        {
            text: gettext('Reload'),
            iconCls: 'fa fa-refresh',
            handler: function () {
                this.up('panel').reload();
            },
        },
        {
            text: `${gettext('Create')}: ${gettext('Directory')}`,
            handler: function () {
                let view = this.up('panel');
                Ext.create('PVE.node.CreateDirectory', {
                    nodename: view.nodename,
                    listeners: {
                        destroy: () => view.reload(),
                    },
                    autoShow: true,
                });
            },
        },
        '->',
        {
            xtype: 'tbtext',
            data: {
                dirName: undefined,
            },
            bind: {
                data: {
                    dirName: '{dirName}',
                },
            },
            tpl: [
                '<tpl if="dirName">',
                gettext('Directory') + ' {dirName}:',
                '<tpl else>',
                Ext.String.format(gettext('No {0} selected'), gettext('directory')),
                '</tpl>',
            ],
        },
        {
            text: gettext('More'),
            iconCls: 'fa fa-bars',
            disabled: true,
            bind: {
                disabled: '{!dirName}',
            },
            menu: [
                {
                    text: gettext('Destroy'),
                    itemId: 'remove',
                    iconCls: 'fa fa-fw fa-trash-o',
                    handler: 'destroyDirectory',
                    disabled: true,
                    bind: {
                        disabled: '{!dirName}',
                    },
                },
            ],
        },
    ],

    reload: function () {
        let me = this;
        me.store.load();
        me.store.sort();
    },

    listeners: {
        activate: function () {
            this.reload();
        },
        selectionchange: function (model, selected) {
            let me = this;
            let vm = me.getViewModel();

            vm.set('path', selected[0]?.data.path || '');
        },
    },

    initComponent: function () {
        let me = this;

        me.nodename = me.pveSelNode.data.node;
        if (!me.nodename) {
            throw 'no node name specified';
        }

        Ext.apply(me, {
            store: {
                fields: ['path', 'device', 'type', 'options', 'unitfile'],
                proxy: {
                    type: 'proxmox',
                    url: `/api2/json/nodes/${me.nodename}/disks/directory`,
                },
                sorters: 'path',
            },
        });

        me.callParent();

        Proxmox.Utils.monStoreErrors(me, me.getStore(), true);
        me.reload();
    },
});
