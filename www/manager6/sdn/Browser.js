Ext.define('PVE.sdn.Browser', {
    extend: 'PVE.panel.Config',
    alias: 'widget.PVE.sdn.Browser',

    onlineHelp: 'chapter_pvesdn',

    initComponent: function () {
        let me = this;

        let nodename = me.pveSelNode.data.node;
        if (!nodename) {
            throw 'no node name specified';
        }
        let sdnId = me.pveSelNode.data.sdn;
        if (!sdnId) {
            throw 'no sdn ID specified';
        }

        me.items = [];

        Ext.apply(me, {
            title: Ext.String.format(
                gettext('Zone {0} on node {1}'),
                `'${sdnId}'`,
                `'${nodename}'`,
            ),
            hstateid: 'sdntab',
        });

        const caps = Ext.state.Manager.get('GuiCap');

        me.items.push({
            nodename: nodename,
            zone: sdnId,
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
                path: `/sdn/zones/${sdnId}`,
            });
        }

        if (me.pveSelNode.data['zone-type'] && me.pveSelNode.data['zone-type'] === 'evpn') {
            me.items.push({
                nodename: nodename,
                zone: sdnId,
                xtype: 'pveSDNEvpnZoneIpVrfPanel',
                title: gettext('IP-VRF'),
                iconCls: 'fa fa-th-list',
                itemId: 'ip-vrf',
            });

            me.items.push({
                nodename: nodename,
                zone: sdnId,
                xtype: 'pveSDNEvpnZoneMacVrfPanel',
                title: gettext('MAC-VRFs'),
                iconCls: 'fa fa-th-list',
                itemId: 'mac-vrfs',
            });
        }

        me.callParent();
    },
});
