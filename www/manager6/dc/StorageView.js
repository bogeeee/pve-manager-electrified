Ext.define(
    'PVE.dc.StorageView',
    {
        extend: 'Ext.grid.GridPanel',

        alias: ['widget.pveStorageView'],

        onlineHelp: 'chapter_storage',

        stateful: true,
        stateId: 'grid-dc-storage',

        createStorageEditWindow: function (type, sid) {
            let schema = PVE.Utils.storageSchema[type];
            if (!schema || !schema.ipanel) {
                throw 'no editor registered for storage type: ' + type;
            }

            Ext.create('PVE.storage.BaseEdit', {
                paneltype: 'PVE.storage.' + schema.ipanel,
                type: type,
                storageId: sid,
                canDoBackups: schema.backups,
                autoShow: true,
                listeners: {
                    destroy: this.reloadStore,
                },
            });
        },

        initComponent: function () {
            let me = this;

            let store = new Ext.data.Store({
                model: 'pve-storage',
                proxy: {
                    type: 'proxmox',
                    url: '/api2/json/storage',
                },
                sorters: {
                    property: 'storage',
                    direction: 'ASC',
                },
            });

            let sm = Ext.create('Ext.selection.RowModel', {});

            let run_editor = function () {
                let rec = sm.getSelection()[0];
                if (!rec) {
                    return;
                }
                let { type, storage } = rec.data;
                me.createStorageEditWindow(type, storage);
            };

            let edit_btn = new Proxmox.button.Button({
                text: gettext('Edit'),
                disabled: true,
                selModel: sm,
                handler: run_editor,
            });
            let remove_btn = Ext.create('Proxmox.button.StdRemoveButton', {
                selModel: sm,
                baseurl: '/storage/',
                callback: () => store.load(),
            });

            // else we cannot dynamically generate the add menu handlers
            let addHandleGenerator = function (type) {
                return function () {
                    me.createStorageEditWindow(type);
                };
            };
            let addMenuItems = [];
            for (const [type, storage] of Object.entries(PVE.Utils.storageSchema)) {
                if (storage.hideAdd) {
                    continue;
                }
                addMenuItems.push({
                    text: PVE.Utils.format_storage_type(type),
                    iconCls: 'fa fa-fw fa-' + storage.faIcon,
                    handler: addHandleGenerator(type),
                });
            }

            Ext.apply(me, {
                store: store,
                reloadStore: () => store.load(),
                selModel: sm,
                viewConfig: {
                    trackOver: false,
                },
                tbar: [
                    {
                        text: gettext('Add'),
                        menu: new Ext.menu.Menu({
                            items: addMenuItems,
                        }),
                    },
                    remove_btn,
                    edit_btn,
                ],
                columns: [
                    {
                        header: 'ID',
                        flex: 2,
                        sortable: true,
                        dataIndex: 'storage',
                    },
                    {
                        header: gettext('Type'),
                        flex: 1,
                        sortable: true,
                        dataIndex: 'type',
                        renderer: PVE.Utils.format_storage_type,
                    },
                    {
                        header: gettext('Content'),
                        flex: 3,
                        sortable: true,
                        dataIndex: 'content',
                        renderer: PVE.Utils.format_content_types,
                    },
                    {
                        header: gettext('Path') + '/' + gettext('Target'),
                        flex: 2,
                        sortable: true,
                        dataIndex: 'path',
                        renderer: function (value, metaData, record) {
                            if (record.data.target) {
                                return record.data.target;
                            }
                            return value;
                        },
                    },
                    {
                        header: gettext('Shared'),
                        flex: 1,
                        sortable: true,
                        dataIndex: 'shared',
                        renderer: Proxmox.Utils.format_boolean,
                    },
                    {
                        header: gettext('Enabled'),
                        flex: 1,
                        sortable: true,
                        dataIndex: 'disable',
                        renderer: Proxmox.Utils.format_neg_boolean,
                    },
                    {
                        header: gettext('Bandwidth Limit'),
                        flex: 2,
                        sortable: true,
                        dataIndex: 'bwlimit',
                    },
                ],
                listeners: {
                    activate: () => store.load(),
                    itemdblclick: run_editor,
                },
            });

            me.callParent();
        },
    },
    function () {
        Ext.define('pve-storage', {
            extend: 'Ext.data.Model',
            fields: [
                'path',
                'type',
                'content',
                'server',
                'portal',
                'target',
                'export',
                'storage',
                { name: 'shared', type: 'boolean' },
                { name: 'disable', type: 'boolean' },
            ],
            idProperty: 'storage',
        });
    },
);
