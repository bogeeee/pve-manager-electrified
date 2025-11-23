Ext.define(
    'PVE.form.StorageSelector',
    {
        extend: 'Proxmox.form.ComboGrid',
        alias: 'widget.pveStorageSelector',
        mixins: ['Proxmox.Mixin.CBind'],

        cbindData: {
            clusterView: false,
        },

        allowBlank: false,
        valueField: 'storage',
        displayField: 'storage',
        listConfig: {
            cbind: {
                clusterView: '{clusterView}',
            },
            width: 450,
            columns: [
                {
                    header: gettext('Name'),
                    dataIndex: 'storage',
                    hideable: false,
                    flex: 1,
                },
                {
                    header: gettext('Type'),
                    width: 75,
                    dataIndex: 'type',
                },
                {
                    header: gettext('Avail'),
                    width: 90,
                    dataIndex: 'avail',
                    renderer: Proxmox.Utils.format_size,
                    cbind: {
                        hidden: '{clusterView}',
                    },
                },
                {
                    header: gettext('Capacity'),
                    width: 90,
                    dataIndex: 'total',
                    renderer: Proxmox.Utils.format_size,
                    cbind: {
                        hidden: '{clusterView}',
                    },
                },
                {
                    header: gettext('Nodes'),
                    width: 120,
                    dataIndex: 'nodes',
                    renderer: (value) => (value ? value : '-- ' + gettext('All') + ' --'),
                    cbind: {
                        hidden: '{!clusterView}',
                    },
                },
                {
                    header: gettext('Shared'),
                    width: 70,
                    dataIndex: 'shared',
                    renderer: Proxmox.Utils.format_boolean,
                    cbind: {
                        hidden: '{!clusterView}',
                    },
                },
            ],
        },

        reloadStorageList: function () {
            let me = this;

            if (me.clusterView) {
                me.getStore().setProxy({
                    type: 'proxmox',
                    url: `/api2/json/storage`,
                });

                // filter here, back-end does not support it currently
                let filters = [(storage) => !storage.data.disable];

                if (me.storageContent) {
                    filters.push((storage) =>
                        storage.data.content.split(',').includes(me.storageContent),
                    );
                }

                if (me.nodename) {
                    filters.push(
                        (storage) =>
                            !storage.data.nodes || storage.data.nodes.includes(me.nodename),
                    );
                }

                me.getStore().clearFilter();
                me.getStore().setFilters(filters);
            } else {
                if (!me.nodename) {
                    return;
                }

                let params = {
                    format: 1,
                };
                if (me.storageContent) {
                    params.content = me.storageContent;
                }
                if (me.targetNode) {
                    params.target = me.targetNode;
                    params.enabled = 1; // skip disabled storages
                }
                me.store.setProxy({
                    type: 'proxmox',
                    url: `/api2/json/nodes/${me.nodename}/storage`,
                    extraParams: params,
                });
            }

            me.store.load(() => me.validate());
        },

        setTargetNode: function (targetNode) {
            var me = this;

            if (!targetNode || me.targetNode === targetNode) {
                return;
            }

            if (me.clusterView) {
                throw 'setting targetNode with clusterView is not implemented';
            }

            me.targetNode = targetNode;

            me.reloadStorageList();
        },

        setNodename: function (nodename) {
            var me = this;

            nodename = nodename || '';

            if (me.nodename === nodename) {
                return;
            }

            me.nodename = nodename;

            me.reloadStorageList();
        },

        initComponent: function () {
            var me = this;

            let nodename = me.nodename;
            me.nodename = undefined;

            var store = Ext.create('Ext.data.Store', {
                model: 'pve-storage-status',
                sorters: {
                    property: 'storage',
                    direction: 'ASC',
                },
            });

            Ext.apply(me, {
                store: store,
            });

            me.callParent();

            me.setNodename(nodename);
        },
    },
    function () {
        Ext.define('pve-storage-status', {
            extend: 'Ext.data.Model',
            fields: ['storage', 'active', 'type', 'avail', 'total', 'nodes', 'shared'],
            idProperty: 'storage',
        });
    },
);
