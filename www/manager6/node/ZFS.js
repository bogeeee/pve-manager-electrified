Ext.define('PVE.node.CreateZFS', {
    extend: 'Proxmox.window.Edit',
    xtype: 'pveCreateZFS',

    onlineHelp: 'chapter_zfs',
    subject: 'ZFS',

    showProgress: true,
    isCreate: true,
    width: 800,

    viewModel: {
        data: {
            raidLevel: 'single',
        },
        formulas: {
            isDraid: (get) => get('raidLevel')?.startsWith('draid'),
        },
    },

    initComponent: function () {
        let me = this;

        if (!me.nodename) {
            throw 'no node name specified';
        }

        Ext.apply(me, {
            url: `/nodes/${me.nodename}/disks/zfs`,
            method: 'POST',
            items: [
                {
                    xtype: 'inputpanel',
                    onGetValues: function (values) {
                        if (values.draidData || values.draidSpares) {
                            let opt = { data: values.draidData, spares: values.draidSpares };
                            values['draid-config'] = PVE.Parser.printPropertyString(opt);
                        }
                        delete values.draidData;
                        delete values.draidSpares;
                        return values;
                    },
                    column1: [
                        {
                            xtype: 'proxmoxtextfield',
                            name: 'name',
                            fieldLabel: gettext('Name'),
                            allowBlank: false,
                            maxLength: 128, // ZFS_MAX_DATASET_NAME_LEN is (256 - some edge case)
                            validator: (v) => {
                                // see zpool_name_valid function in libzfs_zpool.c
                                if (v.match(/^(mirror|raidz|draid|spare)/) || v === 'log') {
                                    return gettext('Cannot use reserved pool name');
                                } else if (!v.match(/^[a-zA-Z][a-zA-Z0-9\-_.]*$/)) {
                                    // note: zfs would support also : and whitespace, but we don't
                                    return gettext('Invalid characters in pool name');
                                }
                                return true;
                            },
                        },
                        {
                            xtype: 'proxmoxcheckbox',
                            name: 'add_storage',
                            fieldLabel: gettext('Add Storage'),
                            value: '1',
                        },
                    ],
                    column2: [
                        {
                            xtype: 'proxmoxKVComboBox',
                            fieldLabel: gettext('RAID Level'),
                            name: 'raidlevel',
                            value: 'single',
                            comboItems: [
                                ['single', gettext('Single Disk')],
                                ['mirror', 'Mirror'],
                                ['raid10', 'RAID10'],
                                ['raidz', 'RAIDZ'],
                                ['raidz2', 'RAIDZ2'],
                                ['raidz3', 'RAIDZ3'],
                                ['draid', 'dRAID'],
                                ['draid2', 'dRAID2'],
                                ['draid3', 'dRAID3'],
                            ],
                            bind: {
                                value: '{raidLevel}',
                            },
                        },
                        {
                            xtype: 'proxmoxKVComboBox',
                            fieldLabel: gettext('Compression'),
                            name: 'compression',
                            value: 'on',
                            comboItems: [
                                ['on', 'on'],
                                ['off', 'off'],
                                ['gzip', 'gzip'],
                                ['lz4', 'lz4'],
                                ['lzjb', 'lzjb'],
                                ['zle', 'zle'],
                                ['zstd', 'zstd'],
                            ],
                        },
                        {
                            xtype: 'proxmoxintegerfield',
                            fieldLabel: gettext('ashift'),
                            minValue: 9,
                            maxValue: 16,
                            value: '12',
                            name: 'ashift',
                        },
                    ],
                    columnB: [
                        {
                            xtype: 'fieldset',
                            title: gettext('dRAID Config'),
                            collapsible: false,
                            bind: {
                                hidden: '{!isDraid}',
                            },
                            layout: 'hbox',
                            padding: '5px 10px',
                            defaults: {
                                flex: 1,
                                layout: 'anchor',
                            },
                            items: [
                                {
                                    xtype: 'proxmoxintegerfield',
                                    name: 'draidData',
                                    fieldLabel: gettext('Data Devs'),
                                    minValue: 1,
                                    allowBlank: false,
                                    disabled: true,
                                    hidden: true,
                                    bind: {
                                        disabled: '{!isDraid}',
                                        hidden: '{!isDraid}',
                                    },
                                    padding: '0 10 0 0',
                                },
                                {
                                    xtype: 'proxmoxintegerfield',
                                    name: 'draidSpares',
                                    fieldLabel: gettext('Spares'),
                                    minValue: 0,
                                    allowBlank: false,
                                    disabled: true,
                                    hidden: true,
                                    bind: {
                                        disabled: '{!isDraid}',
                                        hidden: '{!isDraid}',
                                    },
                                    padding: '0 0 0 10',
                                },
                            ],
                        },
                        {
                            xtype: 'pmxMultiDiskSelector',
                            name: 'devices',
                            nodename: me.nodename,
                            diskType: 'unused',
                            includePartitions: true,
                            height: 200,
                            emptyText: gettext('No Disks unused'),
                            itemId: 'disklist',
                        },
                    ],
                },
                {
                    xtype: 'displayfield',
                    padding: '5 0 0 0',
                    userCls: 'pmx-hint',
                    value:
                        'Note: ZFS is not compatible with disks backed by a hardware ' +
                        'RAID controller. For details see <a target="_blank" href="' +
                        Proxmox.Utils.get_help_link('chapter_zfs') +
                        '">the reference documentation</a>.',
                },
            ],
        });

        me.callParent();
    },
});

Ext.define('PVE.node.ZFSList', {
    extend: 'Ext.grid.Panel',
    xtype: 'pveZFSList',

    viewModel: {
        data: {
            pool: '',
        },
    },

    controller: {
        xclass: 'Ext.app.ViewController',

        destroyPool: function () {
            let me = this;
            let vm = me.getViewModel();
            let view = me.getView();

            const pool = vm.get('pool');

            if (!view.nodename) {
                throw 'no node name specified';
            }

            if (!pool) {
                throw 'no pool specified';
            }

            Ext.create('PVE.window.SafeDestroyStorage', {
                url: `/nodes/${view.nodename}/disks/zfs/${pool}`,
                item: { id: pool },
                taskName: 'zfsremove',
                taskDone: () => {
                    view.reload();
                },
            }).show();
        },
    },

    stateful: true,
    stateId: 'grid-node-zfs',
    columns: [
        {
            text: gettext('Name'),
            dataIndex: 'name',
            flex: 1,
        },
        {
            header: gettext('Size'),
            renderer: Proxmox.Utils.format_size,
            dataIndex: 'size',
        },
        {
            header: gettext('Free'),
            renderer: Proxmox.Utils.format_size,
            dataIndex: 'free',
        },
        {
            header: gettext('Allocated'),
            renderer: Proxmox.Utils.format_size,
            dataIndex: 'alloc',
        },
        {
            header: gettext('Fragmentation'),
            renderer: function (value) {
                return value.toString() + '%';
            },
            dataIndex: 'frag',
        },
        {
            header: gettext('Health'),
            renderer: PVE.Utils.render_zfs_health,
            dataIndex: 'health',
        },
        {
            header: gettext('Deduplication'),
            hidden: true,
            renderer: function (value) {
                return value.toFixed(2).toString() + 'x';
            },
            dataIndex: 'dedup',
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
            text: gettext('Create') + ': ZFS',
            handler: function () {
                let view = this.up('panel');
                Ext.create('PVE.node.CreateZFS', {
                    nodename: view.nodename,
                    listeners: {
                        destroy: () => view.reload(),
                    },
                    autoShow: true,
                });
            },
        },
        {
            text: gettext('Detail'),
            itemId: 'detailbtn',
            disabled: true,
            handler: function () {
                let view = this.up('panel');
                let selection = view.getSelection();
                if (selection.length) {
                    view.show_detail(selection[0].get('name'));
                }
            },
        },
        '->',
        {
            xtype: 'tbtext',
            data: {
                pool: undefined,
            },
            bind: {
                data: {
                    pool: '{pool}',
                },
            },
            tpl: [
                '<tpl if="pool">',
                'Pool {pool}:',
                '<tpl else>',
                Ext.String.format(gettext('No {0} selected'), 'pool'),
                '</tpl>',
            ],
        },
        {
            text: gettext('More'),
            iconCls: 'fa fa-bars',
            disabled: true,
            bind: {
                disabled: '{!pool}',
            },
            menu: [
                {
                    text: gettext('Destroy'),
                    itemId: 'remove',
                    iconCls: 'fa fa-fw fa-trash-o',
                    handler: 'destroyPool',
                    disabled: true,
                    bind: {
                        disabled: '{!pool}',
                    },
                },
            ],
        },
    ],

    show_detail: function (zpool) {
        let me = this;

        Ext.create('Proxmox.window.ZFSDetail', {
            zpool,
            nodename: me.nodename,
        }).show();
    },

    set_button_status: function () {
        var _me = this;
    },

    reload: function () {
        var me = this;
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

            me.down('#detailbtn').setDisabled(selected.length === 0);
            vm.set('pool', selected[0]?.data.name || '');
        },
        itemdblclick: function (grid, record) {
            this.show_detail(record.get('name'));
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
                fields: ['name', 'size', 'free', 'alloc', 'dedup', 'frag', 'health'],
                proxy: {
                    type: 'proxmox',
                    url: `/api2/json/nodes/${me.nodename}/disks/zfs`,
                },
                sorters: 'name',
            },
        });

        me.callParent();

        Proxmox.Utils.monStoreErrors(me, me.getStore(), true);
        me.reload();
    },
});
