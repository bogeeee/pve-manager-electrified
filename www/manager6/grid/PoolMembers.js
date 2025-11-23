Ext.define('PVE.pool.AddVM', {
    extend: 'Proxmox.window.Edit',

    width: 800,
    height: 600,
    resizable: true,

    isAdd: true,
    isCreate: true,

    extraRequestParams: {
        'allow-move': 1,
    },

    initComponent: function () {
        var me = this;

        if (!me.pool) {
            throw 'no pool specified';
        }

        me.url = '/pools/';
        me.method = 'PUT';
        me.extraRequestParams.poolid = me.pool;

        var vmsField = Ext.create('Ext.form.field.Text', {
            name: 'vms',
            hidden: true,
            allowBlank: false,
        });

        let basicFilter = (data) =>
            (data.type === 'lxc' || data.type === 'qemu') && data.pool !== me.pool;

        var vmStore = Ext.create('Ext.data.Store', {
            model: 'PVEResources',
            sorters: [
                {
                    property: 'vmid',
                    direction: 'ASC',
                },
            ],
            filters: [(item) => basicFilter(item.data)],
        });

        var vmGrid = Ext.create('widget.grid', {
            store: vmStore,
            border: true,
            height: 480,
            scrollable: true,
            selModel: {
                selType: 'checkboxmodel',
                mode: 'SIMPLE',
                listeners: {
                    selectionchange: function (model, selected, opts) {
                        var selectedVms = [];
                        selected.forEach(function (vm) {
                            selectedVms.push(vm.data.vmid);
                        });
                        vmsField.setValue(selectedVms);
                    },
                },
            },
            tbar: [
                '->',
                gettext('Filter') + ':',
                ' ',
                {
                    xtype: 'textfield',
                    width: 200,
                    enableKeyEvents: true,
                    emptyText: gettext('Name, Node, VMID'),
                    submitValue: false,
                    listeners: {
                        keyup: {
                            buffer: 350,
                            fn: function (field) {
                                let needle = field.getValue().toLocaleLowerCase();
                                if (needle?.length === 0) {
                                    this.triggers.clear.setVisible(false);
                                }
                                let matchesNeedle = (v) => v?.toLocaleLowerCase().includes(needle);
                                vmStore.clearFilter(true);
                                vmStore.filter([
                                    {
                                        filterFn: ({ data }) =>
                                            basicFilter(data) &&
                                            (matchesNeedle(data.vmid.toString()) ||
                                                matchesNeedle(data.name) ||
                                                matchesNeedle(data.node)),
                                    },
                                ]);
                            },
                        },
                        change: function (field, newValue, oldValue) {
                            if (newValue !== this.originalValue) {
                                this.triggers.clear.setVisible(true);
                            }
                        },
                    },
                    triggers: {
                        clear: {
                            cls: 'pmx-clear-trigger',
                            weight: -1,
                            hidden: true,
                            handler: function () {
                                this.triggers.clear.setVisible(false);
                                this.setValue(this.originalValue);
                                vmStore.clearFilter(true);
                                vmStore.filter([
                                    {
                                        filterFn: ({ data }) => basicFilter(data),
                                    },
                                ]);
                            },
                        },
                    },
                },
            ],
            columns: [
                {
                    header: 'ID',
                    dataIndex: 'vmid',
                    width: 60,
                },
                {
                    header: gettext('Node'),
                    dataIndex: 'node',
                },
                {
                    header: gettext('Current Pool'),
                    dataIndex: 'pool',
                },
                {
                    header: gettext('Status'),
                    dataIndex: 'uptime',
                    renderer: (v) => (v ? Proxmox.Utils.runningText : Proxmox.Utils.stoppedText),
                },
                {
                    header: gettext('Name'),
                    dataIndex: 'name',
                    flex: 1,
                },
                {
                    header: gettext('Type'),
                    dataIndex: 'type',
                },
            ],
        });

        Ext.apply(me, {
            subject: gettext('Virtual Machine'),
            items: [
                vmsField,
                vmGrid,
                {
                    xtype: 'displayfield',
                    userCls: 'pmx-hint',
                    value: gettext(
                        'Selected guests who are already part of a pool will be removed from it first.',
                    ),
                },
            ],
        });

        me.callParent();
        vmStore.load();
    },
});

Ext.define('PVE.pool.AddStorage', {
    extend: 'Proxmox.window.Edit',

    initComponent: function () {
        var me = this;

        if (!me.pool) {
            throw 'no pool specified';
        }

        me.isCreate = true;
        me.isAdd = true;
        me.url = '/pools/';
        me.method = 'PUT';
        me.extraRequestParams.poolid = me.pool;

        Ext.apply(me, {
            subject: gettext('Storage'),
            width: 350,
            items: [
                {
                    xtype: 'pveStorageSelector',
                    name: 'storage',
                    nodename: 'localhost',
                    autoSelect: false,
                    value: '',
                    fieldLabel: gettext('Storage'),
                },
            ],
        });

        me.callParent();
    },
});

Ext.define('PVE.grid.PoolMembers', {
    extend: 'Ext.grid.GridPanel',
    alias: ['widget.pvePoolMembers'],

    stateful: true,
    stateId: 'grid-pool-members',

    initComponent: function () {
        var me = this;

        if (!me.pool) {
            throw 'no pool specified';
        }

        me.rstore = Ext.create('Proxmox.data.UpdateStore', {
            interval: 10000,
            model: 'PVEResources',
            proxy: {
                type: 'proxmox',
                root: 'data[0].members',
                url: `/api2/json/pools/?poolid=${me.pool}`,
            },
            autoStart: true,
        });

        let store = Ext.create('Proxmox.data.DiffStore', {
            rstore: me.rstore,
            sorters: [
                {
                    property: 'type',
                    direction: 'ASC',
                },
            ],
        });

        var coldef = PVE.data.ResourceStore.defaultColumns().filter(
            (c) => c.dataIndex !== 'tags' && c.dataIndex !== 'lock',
        );

        const reload = function () {
            me.rstore.load();
        };

        var sm = Ext.create('Ext.selection.RowModel', {});

        var remove_btn = new Proxmox.button.Button({
            text: gettext('Remove'),
            disabled: true,
            selModel: sm,
            confirmMsg: function (rec) {
                return Ext.String.format(
                    gettext('Are you sure you want to remove entry {0}'),
                    "'" + rec.data.id + "'",
                );
            },
            handler: function (btn, event, rec) {
                var params = { delete: 1, poolid: me.pool };
                if (rec.data.type === 'storage') {
                    params.storage = rec.data.storage;
                } else if (
                    rec.data.type === 'qemu' ||
                    rec.data.type === 'lxc' ||
                    rec.data.type === 'openvz'
                ) {
                    params.vms = rec.data.vmid;
                } else {
                    throw 'unknown resource type';
                }

                Proxmox.Utils.API2Request({
                    url: '/pools/',
                    method: 'PUT',
                    params: params,
                    waitMsgTarget: me,
                    callback: function () {
                        reload();
                    },
                    failure: function (response, opts) {
                        Ext.Msg.alert(gettext('Error'), response.htmlStatus);
                    },
                });
            },
        });

        Ext.apply(me, {
            store: store,
            selModel: sm,
            tbar: [
                {
                    text: gettext('Add'),
                    menu: new Ext.menu.Menu({
                        items: [
                            {
                                text: gettext('Virtual Machine'),
                                iconCls: 'fa fa-desktop',
                                handler: function () {
                                    var win = Ext.create('PVE.pool.AddVM', { pool: me.pool });
                                    win.on('destroy', reload);
                                    win.show();
                                },
                            },
                            {
                                text: gettext('Storage'),
                                iconCls: 'fa fa-hdd-o',
                                handler: function () {
                                    var win = Ext.create('PVE.pool.AddStorage', { pool: me.pool });
                                    win.on('destroy', reload);
                                    win.show();
                                },
                            },
                        ],
                    }),
                },
                remove_btn,
            ],
            viewConfig: {
                stripeRows: true,
            },
            columns: coldef,
            listeners: {
                itemcontextmenu: PVE.Utils.createCmdMenu,
                itemdblclick: function (v, record) {
                    var ws = me.up('pveStdWorkspace');
                    ws.selectById(record.data.id);
                },
                activate: reload,
                destroy: () => me.rstore.stopUpdate(),
            },
        });

        me.callParent();
    },
});
