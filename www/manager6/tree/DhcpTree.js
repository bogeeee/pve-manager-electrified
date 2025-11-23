Ext.define('PVE.sdn.DhcpTree', {
    extend: 'Ext.tree.Panel',
    xtype: 'pveDhcpTree',

    layout: 'fit',
    rootVisible: false,
    animate: false,

    store: {
        sorters: ['ip', 'name'],
    },

    controller: {
        xclass: 'Ext.app.ViewController',

        reload: function () {
            let me = this;

            Proxmox.Utils.API2Request({
                url: `/cluster/sdn/ipams/pve/status`,
                method: 'GET',
                success: function (response, opts) {
                    let root = {
                        name: '__root',
                        expanded: true,
                        children: [],
                    };

                    let zones = {};
                    let vnets = {};
                    let subnets = {};

                    response.result.data.forEach((element) => {
                        element.leaf = true;

                        if (!(element.zone in zones)) {
                            let zone = {
                                name: element.zone,
                                type: 'zone',
                                iconCls: 'fa fa-th',
                                expanded: true,
                                children: [],
                            };

                            zones[element.zone] = zone;
                            root.children.push(zone);
                        }

                        if (!(element.vnet in vnets)) {
                            let vnet = {
                                name: element.vnet,
                                zone: element.zone,
                                type: 'vnet',
                                iconCls: 'fa fa-network-wired x-fa-treepanel',
                                expanded: true,
                                children: [],
                            };

                            vnets[element.vnet] = vnet;
                            zones[element.zone].children.push(vnet);
                        }

                        if (!(element.subnet in subnets)) {
                            let subnet = {
                                name: element.subnet,
                                zone: element.zone,
                                vnet: element.vnet,
                                type: 'subnet',
                                iconCls: 'x-tree-icon-none',
                                expanded: true,
                                children: [],
                            };

                            subnets[element.subnet] = subnet;
                            vnets[element.vnet].children.push(subnet);
                        }

                        element.name = element.vmid; // for sorting
                        element.type = 'mapping';
                        element.iconCls = 'x-tree-icon-none';
                        subnets[element.subnet].children.push(element);
                    });

                    me.getView().setRootNode(root);
                },
            });
        },

        init: function (view) {
            let me = this;
            me.reload();
        },

        onDelete: function (table, rI, cI, item, e, { data }) {
            let me = this;
            let view = me.getView();

            Ext.Msg.show({
                title: gettext('Confirm'),
                icon: Ext.Msg.WARNING,
                message: Ext.String.format(
                    gettext('Are you sure you want to remove DHCP mapping {0}'),
                    `${data.mac} / ${data.ip}`,
                ),
                buttons: Ext.Msg.YESNO,
                defaultFocus: 'no',
                callback: function (btn) {
                    if (btn !== 'yes') {
                        return;
                    }

                    let params = {
                        zone: data.zone,
                        mac: data.mac,
                        ip: data.ip,
                    };

                    let encodedParams = Ext.Object.toQueryString(params);

                    let url = `/cluster/sdn/vnets/${data.vnet}/ips?${encodedParams}`;

                    Proxmox.Utils.API2Request({
                        url,
                        method: 'DELETE',
                        waitMsgTarget: view,
                        failure: function (response, opts) {
                            Ext.Msg.alert(gettext('Error'), response.htmlStatus);
                        },
                        callback: me.reload.bind(me),
                    });
                },
            });
        },

        editAction: function (_grid, _rI, _cI, _item, _e, rec) {
            this.edit(rec);
        },

        editDblClick: function () {
            let me = this;

            let view = me.getView();
            let selection = view.getSelection();

            if (!selection || selection.length < 1) {
                return;
            }

            me.edit(selection[0]);
        },

        edit: function (rec) {
            let me = this;

            if (rec.data.type === 'mapping' && !rec.data.gateway) {
                me.openEditWindow(rec.data);
            }
        },

        openEditWindow: function (data) {
            let me = this;

            let extraRequestParams = {
                mac: data.mac,
                zone: data.zone,
                vnet: data.vnet,
            };

            if (data.vmid) {
                extraRequestParams.vmid = data.vmid;
            }

            Ext.create('PVE.sdn.IpamEdit', {
                autoShow: true,
                mapping: data,
                extraRequestParams,
                listeners: {
                    destroy: () => me.reload(),
                },
            });
        },
    },

    listeners: {
        itemdblclick: 'editDblClick',
    },

    tbar: [
        {
            xtype: 'proxmoxButton',
            text: gettext('Reload'),
            handler: 'reload',
        },
    ],

    columns: [
        {
            xtype: 'treecolumn',
            text: gettext('Name / VMID'),
            dataIndex: 'name',
            width: 200,
            renderer: function (value, meta, record) {
                if (record.get('gateway')) {
                    return gettext('Gateway');
                }

                return record.get('name') ?? record.get('vmid') ?? ' ';
            },
        },
        {
            text: gettext('IP Address'),
            dataIndex: 'ip',
            width: 200,
        },
        {
            text: 'MAC',
            dataIndex: 'mac',
            width: 200,
        },
        {
            text: gettext('Gateway'),
            dataIndex: 'gateway',
            width: 200,
        },
        {
            header: gettext('Actions'),
            xtype: 'actioncolumn',
            dataIndex: 'text',
            width: 150,
            items: [
                {
                    handler: function (table, rI, cI, item, e, { data }) {
                        let me = this;

                        Ext.create('PVE.sdn.IpamEdit', {
                            autoShow: true,
                            mapping: {},
                            isCreate: true,
                            extraRequestParams: {
                                vnet: data.name,
                                zone: data.zone,
                            },
                            listeners: {
                                destroy: () => {
                                    me.up('pveDhcpTree').controller.reload();
                                },
                            },
                        });
                    },
                    getTip: (v, m, rec) => gettext('Add'),
                    getClass: (v, m, { data }) => {
                        if (data.type === 'vnet') {
                            return 'fa fa-plus-square';
                        }

                        return 'pmx-hidden';
                    },
                },
                {
                    handler: 'editAction',
                    getTip: (v, m, rec) => gettext('Edit'),
                    getClass: (v, m, { data }) => {
                        if (data.type === 'mapping' && !data.gateway) {
                            return 'fa fa-pencil fa-fw';
                        }

                        return 'pmx-hidden';
                    },
                },
                {
                    handler: 'onDelete',
                    getTip: (v, m, rec) => gettext('Delete'),
                    getClass: (v, m, { data }) => {
                        if (data.type === 'mapping' && !data.gateway) {
                            return 'fa critical fa-trash-o';
                        }

                        return 'pmx-hidden';
                    },
                },
            ],
        },
    ],
});
