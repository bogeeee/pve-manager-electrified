Ext.define('PVE.sdn.IpamView', {
    extend: 'Ext.grid.GridPanel',
    alias: ['widget.pveSDNIpamView'],

    stateful: true,
    stateId: 'grid-sdn-ipam',

    createSDNEditWindow: function (type, sid) {
        let schema = PVE.Utils.sdnipamSchema[type];
        if (!schema || !schema.ipanel) {
            throw 'no editor registered for ipam type: ' + type;
        }

        Ext.create('PVE.sdn.ipams.BaseEdit', {
            paneltype: 'PVE.sdn.ipams.' + schema.ipanel,
            type: type,
            ipam: sid,
            autoShow: true,
            listeners: {
                destroy: this.reloadStore,
            },
        });
    },

    initComponent: function () {
        let me = this;

        let store = new Ext.data.Store({
            model: 'pve-sdn-ipam',
            proxy: {
                type: 'proxmox',
                url: '/api2/json/cluster/sdn/ipams',
            },
            sorters: {
                property: 'ipam',
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
                ipam = rec.data.ipam;
            me.createSDNEditWindow(type, ipam);
        };

        let edit_btn = new Proxmox.button.Button({
            text: gettext('Edit'),
            disabled: true,
            selModel: sm,
            handler: run_editor,
        });

        let remove_btn = Ext.create('Proxmox.button.StdRemoveButton', {
            selModel: sm,
            baseurl: '/cluster/sdn/ipams/',
            callback: () => store.load(),
        });

        // else we cannot dynamically generate the add menu handlers
        let addHandleGenerator = function (type) {
            return function () {
                me.createSDNEditWindow(type);
            };
        };
        let addMenuItems = [];
        for (const [type, ipam] of Object.entries(PVE.Utils.sdnipamSchema)) {
            if (ipam.hideAdd) {
                continue;
            }
            addMenuItems.push({
                text: PVE.Utils.format_sdnipam_type(type),
                iconCls: 'fa fa-fw fa-' + ipam.faIcon,
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
                    dataIndex: 'ipam',
                    renderer: Ext.htmlEncode,
                },
                {
                    header: gettext('Type'),
                    flex: 1,
                    dataIndex: 'type',
                    renderer: PVE.Utils.format_sdnipam_type,
                },
                {
                    header: 'url',
                    flex: 1,
                    dataIndex: 'url',
                    renderer: Ext.htmlEncode,
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
