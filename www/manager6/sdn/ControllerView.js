Ext.define('PVE.sdn.ControllerView', {
    extend: 'Ext.grid.GridPanel',
    alias: ['widget.pveSDNControllerView'],

    onlineHelp: 'pvesdn_config_controllers',

    stateful: true,
    stateId: 'grid-sdn-controller',

    createSDNControllerEditWindow: function (type, sid) {
        var schema = PVE.Utils.sdncontrollerSchema[type];
        if (!schema || !schema.ipanel) {
            throw 'no editor registered for controller type: ' + type;
        }

        Ext.create('PVE.sdn.controllers.BaseEdit', {
            paneltype: 'PVE.sdn.controllers.' + schema.ipanel,
            type: type,
            controllerid: sid,
            autoShow: true,
            listeners: {
                destroy: this.reloadStore,
            },
        });
    },

    initComponent: function () {
        var me = this;

        var store = new Ext.data.Store({
            model: 'pve-sdn-controller',
            proxy: {
                type: 'proxmox',
                url: '/api2/json/cluster/sdn/controllers?pending=1',
            },
            sorters: {
                property: 'controller',
                direction: 'ASC',
            },
        });

        let sm = Ext.create('Ext.selection.RowModel', {});

        let run_editor = function () {
            let rec = sm.getSelection()[0];
            if (!rec) {
                return;
            }
            let type = rec.data.type,
                controller = rec.data.controller;
            me.createSDNControllerEditWindow(type, controller);
        };

        let edit_btn = new Proxmox.button.Button({
            text: gettext('Edit'),
            disabled: true,
            selModel: sm,
            handler: run_editor,
        });

        let remove_btn = Ext.create('Proxmox.button.StdRemoveButton', {
            selModel: sm,
            baseurl: '/cluster/sdn/controllers/',
            callback: () => store.load(),
        });

        // else we cannot dynamically generate the add menu handlers
        let addHandleGenerator = function (type) {
            return function () {
                me.createSDNControllerEditWindow(type);
            };
        };
        let addMenuItems = [];
        for (const [type, controller] of Object.entries(PVE.Utils.sdncontrollerSchema)) {
            if (controller.hideAdd) {
                continue;
            }
            addMenuItems.push({
                text: PVE.Utils.format_sdncontroller_type(type),
                iconCls: 'fa fa-fw fa-' + controller.faIcon,
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
                    dataIndex: 'controller',
                    renderer: function (value, metaData, rec) {
                        return PVE.Utils.render_sdn_pending(rec, value, 'controller', 1);
                    },
                },
                {
                    header: gettext('Type'),
                    flex: 1,
                    sortable: true,
                    dataIndex: 'type',
                    renderer: function (value, metaData, rec) {
                        return PVE.Utils.render_sdn_pending(rec, value, 'type', 1);
                    },
                },
                {
                    header: gettext('Node'),
                    flex: 1,
                    sortable: true,
                    dataIndex: 'node',
                    renderer: function (value, metaData, rec) {
                        return PVE.Utils.render_sdn_pending(rec, value, 'node', 1);
                    },
                },
                {
                    header: gettext('State'),
                    width: 100,
                    dataIndex: 'state',
                    renderer: function (value, metaData, rec) {
                        return PVE.Utils.render_sdn_pending_state(rec, value);
                    },
                },
            ],
            listeners: {
                activate: () => store.load(),
                itemdblclick: run_editor,
            },
        });
        store.load();
        me.callParent();
    },
});
