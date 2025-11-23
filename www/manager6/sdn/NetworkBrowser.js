Ext.define('PVE.network.Browser', {
    extend: 'PVE.panel.Config',
    alias: 'widget.PVE.network.Browser',

    initComponent: function () {
        let me = this;
        let data = me.pveSelNode.data;

        let node = data.node;
        if (!node) {
            throw 'no node name specified';
        }

        let name = data.network;
        if (!name) {
            throw 'no name specified';
        }

        let networkType = data['network-type'];
        if (!networkType) {
            throw 'no type specified';
        }

        me.items = [];

        if (networkType === 'fabric') {
            me.onlineHelp = 'pvesdn_config_fabrics';

            me.items.push({
                nodename: node,
                fabricId: name,
                protocol: me.pveSelNode.data.protocol,
                xtype: 'pveSDNFabricRoutesContentView',
                title: gettext('Routes'),
                iconCls: 'fa fa-exchange',
                itemId: 'routes',
                width: '100%',
                store: {
                    proxy: {
                        type: 'proxmox',
                        url: `/api2/json/nodes/${node}/sdn/fabrics/${name}/routes`,
                        reader: {
                            type: 'json',
                            rootProperty: 'data',
                        },
                    },
                    autoLoad: true,
                },
            });

            me.items.push({
                nodename: node,
                fabricId: name,
                protocol: me.pveSelNode.data.protocol,
                xtype: 'pveSDNFabricNeighborsContentView',
                title: gettext('Neighbors'),
                iconCls: 'fa fa-handshake-o',
                itemId: 'neighbors',
                width: '100%',
                store: {
                    proxy: {
                        type: 'proxmox',
                        url: `/api2/json/nodes/${node}/sdn/fabrics/${name}/neighbors`,
                        reader: {
                            type: 'json',
                            rootProperty: 'data',
                        },
                    },
                    autoLoad: true,
                },
            });

            me.items.push({
                nodename: node,
                fabricId: name,
                protocol: me.pveSelNode.data.protocol,
                xtype: 'pveSDNFabricInterfacesContentView',
                title: gettext('Interfaces'),
                iconCls: 'fa fa-upload',
                itemId: 'interfaces',
                width: '100%',
                store: {
                    proxy: {
                        type: 'proxmox',
                        url: `/api2/json/nodes/${node}/sdn/fabrics/${name}/interfaces`,
                        reader: {
                            type: 'json',
                            rootProperty: 'data',
                        },
                    },
                    autoLoad: true,
                },
            });
        } else if (networkType === 'zone') {
            const caps = Ext.state.Manager.get('GuiCap');

            me.items.push({
                nodename: node,
                zone: name,
                xtype: 'pveSDNZoneContentPanel',
                title: gettext('Content'),
                iconCls: 'fa fa-th',
                itemId: 'content',
            });

            if (caps.sdn['Permissions.Modify']) {
                me.items.push({
                    xtype: 'pveACLView',
                    title: gettext('Permissions'),
                    iconCls: 'fa fa-unlock',
                    itemId: 'permissions',
                    path: `/sdn/zones/${name}`,
                });
            }

            me.items.push({
                nodename: node,
                zone: name,
                xtype: 'pveSDNZoneBridgePanel',
                title: gettext('Bridges'),
                iconCls: 'fa fa-network-wired x-fa-sdn-treelist',
                itemId: 'bridges',
            });

            if (data['zone-type'] && data['zone-type'] === 'evpn') {
                me.items.push({
                    nodename: node,
                    zone: name,
                    xtype: 'pveSDNEvpnZoneIpVrfPanel',
                    title: gettext('IP-VRF'),
                    iconCls: 'fa fa-th-list',
                    itemId: 'ip-vrf',
                });

                me.items.push({
                    nodename: node,
                    zone: name,
                    xtype: 'pveSDNEvpnZoneMacVrfPanel',
                    title: gettext('MAC-VRFs'),
                    iconCls: 'fa fa-th-list',
                    itemId: 'mac-vrfs',
                });
            }
        } else {
            me.items.push({
                xtype: 'container',
                title: gettext('Content'),
                iconCls: 'fa fa-th',
                itemId: 'content',
                html: `unknown network type: ${networkType}`,
                width: '100%',
            });
        }

        Ext.apply(me, {
            title: Ext.String.format(
                gettext('{0} {1} on node {2}'),
                `${networkType}`,
                `'${name}'`,
                `'${node}'`,
            ),
            hstateid: 'networktab',
        });

        me.callParent();
    },
});
