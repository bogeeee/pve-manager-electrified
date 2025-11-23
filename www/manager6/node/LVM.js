Ext.define('PVE.node.CreateLVM', {
    extend: 'Proxmox.window.Edit',
    xtype: 'pveCreateLVM',

    onlineHelp: 'chapter_lvm',
    subject: 'LVM Volume Group',

    showProgress: true,
    isCreate: true,

    initComponent: function () {
        let me = this;

        if (!me.nodename) {
            throw 'no node name specified';
        }

        me.isCreate = true;

        Ext.applyIf(me, {
            url: `/nodes/${me.nodename}/disks/lvm`,
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

Ext.define('PVE.node.LVMList', {
    extend: 'Ext.tree.Panel',
    xtype: 'pveLVMList',

    viewModel: {
        data: {
            volumeGroup: '',
        },
    },

    controller: {
        xclass: 'Ext.app.ViewController',

        destroyVolumeGroup: function () {
            let me = this;
            let vm = me.getViewModel();
            let view = me.getView();

            const volumeGroup = vm.get('volumeGroup');

            if (!view.nodename) {
                throw 'no node name specified';
            }

            if (!volumeGroup) {
                throw 'no volume group specified';
            }

            Ext.create('PVE.window.SafeDestroyStorage', {
                url: `/nodes/${view.nodename}/disks/lvm/${volumeGroup}`,
                item: { id: volumeGroup },
                taskName: 'lvmremove',
                taskDone: () => {
                    view.reload();
                },
            }).show();
        },
    },

    emptyText: PVE.Utils.renderNotFound('VGs'),

    stateful: true,
    stateId: 'grid-node-lvm',

    rootVisible: false,
    useArrows: true,

    columns: [
        {
            xtype: 'treecolumn',
            text: gettext('Name'),
            dataIndex: 'name',
            flex: 1,
        },
        {
            text: gettext('Number of LVs'),
            dataIndex: 'lvcount',
            width: 150,
            align: 'right',
        },
        {
            header: gettext('Assigned to LVs'),
            width: 130,
            dataIndex: 'usage',
            tdCls: 'x-progressbar-default-cell',
            xtype: 'widgetcolumn',
            widget: {
                xtype: 'pveProgressBar',
            },
        },
        {
            header: gettext('Size'),
            width: 100,
            align: 'right',
            sortable: true,
            renderer: Proxmox.Utils.format_size,
            dataIndex: 'size',
        },
        {
            header: gettext('Free'),
            width: 100,
            align: 'right',
            sortable: true,
            renderer: Proxmox.Utils.format_size,
            dataIndex: 'free',
        },
    ],

    tbar: [
        {
            text: gettext('Reload'),
            iconCls: 'fa fa-refresh',
            handler: function () {
                this.up('panel').reload();
            },
        },
        {
            text: gettext('Create') + ': Volume Group',
            handler: function () {
                let view = this.up('panel');
                Ext.create('PVE.node.CreateLVM', {
                    nodename: view.nodename,
                    taskDone: () => view.reload(),
                    autoShow: true,
                });
            },
        },
        '->',
        {
            xtype: 'tbtext',
            data: {
                volumeGroup: undefined,
            },
            bind: {
                data: {
                    volumeGroup: '{volumeGroup}',
                },
            },
            tpl: [
                '<tpl if="volumeGroup">',
                'Volume group {volumeGroup}:',
                '<tpl else>',
                Ext.String.format(gettext('No {0} selected'), 'volume group'),
                '</tpl>',
            ],
        },
        {
            text: gettext('More'),
            iconCls: 'fa fa-bars',
            disabled: true,
            bind: {
                disabled: '{!volumeGroup}',
            },
            menu: [
                {
                    text: gettext('Destroy'),
                    itemId: 'remove',
                    iconCls: 'fa fa-fw fa-trash-o',
                    handler: 'destroyVolumeGroup',
                    disabled: true,
                    bind: {
                        disabled: '{!volumeGroup}',
                    },
                },
            ],
        },
    ],

    reload: function () {
        let me = this;
        let sm = me.getSelectionModel();
        Proxmox.Utils.API2Request({
            url: `/nodes/${me.nodename}/disks/lvm`,
            waitMsgTarget: me,
            method: 'GET',
            failure: (response, opts) => Proxmox.Utils.setErrorMask(me, response.htmlStatus),
            success: function (response, opts) {
                sm.deselectAll();
                me.setRootNode(response.result.data);
                me.expandAll();
            },
        });
    },

    listeners: {
        activate: function () {
            this.reload();
        },
        selectionchange: function (model, selected) {
            let me = this;
            let vm = me.getViewModel();

            if (selected.length < 1 || selected[0].data.parentId !== 'root') {
                vm.set('volumeGroup', '');
            } else {
                vm.set('volumeGroup', selected[0].data.name);
            }
        },
    },

    selModel: 'treemodel',
    fields: [
        'name',
        'size',
        'free',
        {
            type: 'string',
            name: 'iconCls',
            calculate: (data) => `fa x-fa-tree fa-${data.leaf ? 'hdd-o' : 'object-group'}`,
        },
        {
            type: 'number',
            name: 'usage',
            calculate: (data) => (data.size - data.free) / data.size,
        },
    ],
    sorters: 'name',

    initComponent: function () {
        let me = this;

        me.nodename = me.pveSelNode.data.node;
        if (!me.nodename) {
            throw 'no node name specified';
        }
        me.callParent();

        me.reload();
    },
});
